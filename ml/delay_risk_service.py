"""Version-pinned inference adapter for the saved delay-risk-v3 artifact.

Run this service with ``requirements-delay-risk.txt``. The serialized model was
created with scikit-learn 1.6.1 and must not be loaded by the resolution runtime.
"""

from __future__ import annotations

import gzip
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ml.model_auth import require_model_token


ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = ROOT / "artifacts-delay_risk_model"
MODEL_PATH = ARTIFACT_DIR / "delay_risk_model.joblib"
HISTORY_PATH = ARTIFACT_DIR / "history_reference.csv.gz"
RECENT_DAYS = 90
SMOOTHING = 10.0


class DelayRiskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issue_created: str = Field(min_length=1, max_length=100)
    issue_priority: str = Field(min_length=1, max_length=100)
    issue_type: str = Field(min_length=1, max_length=100)
    issue_proj: str = Field(min_length=1, max_length=200)
    issue_reporter: str = Field(default="new-intake", min_length=1, max_length=100)


@lru_cache(maxsize=1)
def load_bundle() -> dict[str, Any]:
    if not MODEL_PATH.exists() or not HISTORY_PATH.exists():
        raise FileNotFoundError("Delay-risk artifact or its historical reference is missing")
    return joblib.load(MODEL_PATH)


@lru_cache(maxsize=1)
def load_history() -> pd.DataFrame:
    with gzip.open(HISTORY_PATH, "rt", encoding="utf-8") as source:
        history = pd.read_csv(source)
    for column in ("created_ts", "resolved_ts", "known_ts"):
        history[column] = pd.to_datetime(history[column], errors="coerce", utc=True).dt.tz_localize(None)
    history["delayed"] = pd.to_numeric(history["delayed"], errors="coerce")
    hours = (history["resolved_ts"] - history["created_ts"]).dt.total_seconds() / 3600
    history["resolution_hours"] = hours.where(hours >= 0)
    return history.sort_values("created_ts", kind="mergesort").reset_index(drop=True)


def _history_block(t: np.ndarray, resolved: np.ndarray, known: np.ndarray, delayed: np.ndarray):
    created_before = np.searchsorted(t, t, side="left")
    created_24h = created_before - np.searchsorted(t, t - np.timedelta64(24, "h"), side="left")
    created_7d = created_before - np.searchsorted(t, t - np.timedelta64(7, "D"), side="left")
    resolved_valid = ~np.isnat(resolved)
    open_now = np.clip(created_before - np.searchsorted(np.sort(resolved[resolved_valid]), t, side="left"), 0, None)
    valid = ~np.isnat(known) & np.isfinite(delayed)
    order = np.argsort(known[valid], kind="mergesort")
    known_sorted, labels = known[valid][order], delayed[valid][order]
    cumulative = np.concatenate(([0.0], np.cumsum(labels)))
    count = np.searchsorted(known_sorted, t, side="left")
    recent_start = np.searchsorted(known_sorted, t - np.timedelta64(RECENT_DAYS, "D"), side="left")
    return {
        "open_now": open_now,
        "created_24h": created_24h,
        "created_7d": created_7d,
        "n_known": count,
        "sum_delayed": cumulative[count],
        "n_recent": count - recent_start,
        "sum_recent": cumulative[count] - cumulative[recent_start],
    }


def _recent_resolution_log_hours(t: np.ndarray, resolved: np.ndarray, log_hours: np.ndarray):
    valid = ~np.isnat(resolved) & np.isfinite(log_hours)
    order = np.argsort(resolved[valid], kind="mergesort")
    times, values = resolved[valid][order], log_hours[valid][order]
    cumulative = np.concatenate(([0.0], np.cumsum(values)))
    end = np.searchsorted(times, t, side="left")
    start = np.searchsorted(times, t - np.timedelta64(RECENT_DAYS, "D"), side="left")
    return cumulative[end] - cumulative[start], (end - start).astype(float)


def build_ticket_features(ticket: dict[str, str], history: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    created = pd.to_datetime(ticket["issue_created"], errors="coerce", utc=True)
    if pd.isna(created):
        raise ValueError("Enter a valid ticket creation timestamp")
    new = pd.DataFrame([{
        "ticket_id": "new-intake",
        "created_ts": created.tz_localize(None),
        "resolved_ts": pd.NaT,
        "known_ts": pd.NaT,
        "delayed": np.nan,
        "resolution_hours": np.nan,
        "priority": ticket["issue_priority"],
        "category": ticket["issue_type"],
        "project": ticket["issue_proj"],
        # The training data uses anonymized reporters. A stable intake cohort avoids collecting identity.
        "reporter": "new-intake",
    }])
    new["_is_new_intake"] = True
    history = history.copy()
    history["_is_new_intake"] = False
    df = pd.concat([history, new], ignore_index=True).sort_values("created_ts", kind="mergesort").reset_index(drop=True)
    df["created_hour"] = df["created_ts"].dt.hour
    df["created_dow"] = df["created_ts"].dt.dayofweek
    df["is_weekend"] = (df["created_dow"] >= 5).astype(int)
    df["created_month"] = df["created_ts"].dt.month
    t = df["created_ts"].to_numpy(dtype="datetime64[ns]")
    resolved = df["resolved_ts"].to_numpy(dtype="datetime64[ns]")
    known = df["known_ts"].to_numpy(dtype="datetime64[ns]")
    delayed = df["delayed"].to_numpy(dtype=float)
    log_hours = np.log1p(df["resolution_hours"].to_numpy(dtype=float))

    overall = _history_block(t, resolved, known, delayed)
    prior = np.where(overall["n_known"] > 0, overall["sum_delayed"] / np.maximum(overall["n_known"], 1), .5)
    recent_rate = (overall["sum_recent"] + SMOOTHING * prior) / (overall["n_recent"] + SMOOTHING)
    for name, key in (("global_open_now", "open_now"), ("global_created_24h", "created_24h"), ("global_created_7d", "created_7d"), ("global_delay_rate", None), ("global_recent_rate", None), ("global_recent_n", "n_recent")):
        df[name] = prior if name == "global_delay_rate" else recent_rate if name == "global_recent_rate" else overall[key]
    sums, counts = _recent_resolution_log_hours(t, resolved, log_hours)
    prior_log = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
    prior_log = pd.Series(prior_log).ffill().bfill().fillna(0).to_numpy()
    df["global_recent_log_hrs"] = (sums + SMOOTHING * prior_log) / (counts + SMOOTHING)

    groups = ["category", "project", "priority", "reporter", "project_category", "project_priority"]
    df["project_category"] = df["project"].astype(str) + "|" + df["category"].astype(str)
    df["project_priority"] = df["project"].astype(str) + "|" + df["priority"].astype(str)
    metrics = ("open_now", "created_24h", "created_7d", "prior_n", "delay_rate", "recent_n", "recent_rate", "gap_hrs", "recent_log_hrs")
    group_features = {f"{group}_{metric}": np.zeros(len(df), dtype=float) for group in groups for metric in metrics}
    global_recent_log = df["global_recent_log_hrs"].to_numpy(dtype=float)
    for group in groups:
        for _, indices in df.groupby(group, sort=False, dropna=False).indices.items():
            ix = np.asarray(indices)
            block = _history_block(t[ix], resolved[ix], known[ix], delayed[ix])
            group_features[f"{group}_open_now"][ix] = block["open_now"]
            group_features[f"{group}_created_24h"][ix] = block["created_24h"]
            group_features[f"{group}_created_7d"][ix] = block["created_7d"]
            group_features[f"{group}_prior_n"][ix] = block["n_known"]
            group_features[f"{group}_delay_rate"][ix] = (block["sum_delayed"] + SMOOTHING * prior[ix]) / (block["n_known"] + SMOOTHING)
            group_features[f"{group}_recent_n"][ix] = block["n_recent"]
            group_features[f"{group}_recent_rate"][ix] = (block["sum_recent"] + SMOOTHING * recent_rate[ix]) / (block["n_recent"] + SMOOTHING)
            group_times = t[ix]
            gaps = np.full(len(ix), np.nan)
            if len(ix) > 1:
                gaps[1:] = (group_times[1:] - group_times[:-1]) / np.timedelta64(1, "h")
            group_features[f"{group}_gap_hrs"][ix] = gaps
            group_sums, group_counts = _recent_resolution_log_hours(group_times, resolved[ix], log_hours[ix])
            group_features[f"{group}_recent_log_hrs"][ix] = (group_sums + SMOOTHING * global_recent_log[ix]) / (group_counts + SMOOTHING)
    for column, values in group_features.items():
        df[column] = values

    # Model training did not one-hot encode reporter; it only used reporter history aggregates.
    df["priority"] = df["priority"].fillna("missing").astype(str)
    df["category"] = df["category"].fillna("missing").astype(str)
    df["project"] = df["project"].fillna("missing").astype(str)
    row = df.loc[df["_is_new_intake"]].tail(1)
    # Keep the established artifact feature order and fail closed if notebook and serving schema drift.
    missing = [column for column in feature_columns if column not in row.columns]
    if missing:
        raise RuntimeError(f"Delay-risk feature schema mismatch: {missing[:3]}")
    return row[feature_columns]


def _risk_category(probability: float) -> str:
    return "low" if probability < .4 else "medium" if probability < .7 else "high"


def _historical_evidence(history: pd.DataFrame, request: DelayRiskRequest, created: pd.Timestamp) -> list[dict[str, Any]]:
    # Only outcomes already known before this ticket's creation are eligible evidence.
    prior = history[(history["created_ts"] < created) & (history["known_ts"] < created)].copy()
    evidence = []
    for field, label, value in (
        ("priority", "Matching priority", request.issue_priority),
        ("category", "Matching issue type", request.issue_type),
        ("project", "Matching project", request.issue_proj),
    ):
        cohort = prior[prior[field].astype(str).str.casefold() == value.casefold()]
        outcomes = pd.to_numeric(cohort["delayed"], errors="coerce").dropna()
        if not outcomes.empty:
            evidence.append({
                "factor": label,
                "value": value,
                "historical_tickets": int(len(outcomes)),
                "historical_delay_rate": round(float(outcomes.mean()), 4),
            })
    return evidence


app = FastAPI(title="OpsPilot AI Delay-Risk Service", version="1.0.0")


@app.get("/health")
def health():
    try:
        bundle = load_bundle()
        load_history()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The delay-risk model is unavailable.") from exc
    return {"status": "available", "service": "delay-risk", "model_id": bundle["model_version"]}


@app.post("/predict/delay-risk")
def predict_delay_risk(request: DelayRiskRequest, _auth: None = Depends(require_model_token)):
    try:
        bundle = load_bundle()
        history = load_history()
        row = build_ticket_features(request.model_dump(), history, bundle["feature_columns"])
        probability = float(bundle["model"].predict_proba(row)[:, 1][0])
        if not np.isfinite(probability) or not 0 <= probability <= 1:
            raise RuntimeError("The delay-risk model returned an invalid probability")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Delay-risk scoring failed; no score was produced.") from exc

    created = pd.to_datetime(request.issue_created, utc=True).tz_localize(None)
    past = history[(history["created_ts"] < created) & (history["known_ts"] < created)]
    known_count = len(past)
    prior_delay_rate = float(past["delayed"].mean()) if known_count else None
    threshold = float(bundle["threshold"])
    return {
        "model_id": bundle["model_version"],
        "risk_probability": probability,
        "risk_category": _risk_category(probability),
        "flagged_for_review": probability >= threshold,
        "decision_threshold": threshold,
        "target_threshold_hours": float(bundle["threshold_hours"]),
        "context": {"historical_outcomes_known_before_ticket": known_count, "historical_delay_rate": prior_delay_rate},
        "explanation": {
            "summary": "The score uses ticket priority, issue type, project, creation time, and historical congestion/outcomes. Complaint text is not a model input.",
            "historical_evidence": _historical_evidence(history, request, created),
            "evidence_cutoff": created.isoformat() + "Z",
            "interpretation": "Historical rates are descriptive cohort evidence, not causal effects or guarantees.",
        },
        "model_version": bundle["model_version"],
        "notes": ["The model estimates probability of resolution taking more than 720 historical training hours.", "Review threshold is tuned for high recall on a historical validation window; treat a flag as a triage prompt, not a guaranteed SLA breach.", "Complaint text is retained by the workflow but is not an input to this trained model."],
    }

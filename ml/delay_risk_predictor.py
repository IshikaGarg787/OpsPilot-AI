"""DEPRECATED - not part of the running service.

The live delay-risk path is ``ml/delay_risk_service.py`` on port 8001. This module
uses different feature settings (SMOOTHING=20 and extra congestion features), so its
scores are NOT interchangeable with the live artifact. It is kept for historical
reference only; do not wire it into an API route.

Original purpose: inference engine and explanation service for Model B.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

# Compatibility shim for scikit-learn unpickling across versions
import sklearn.compose._column_transformer as ct

if not hasattr(ct, "_RemainderColsList"):
    class _RemainderColsList(list):
        pass
    ct._RemainderColsList = _RemainderColsList

logger = logging.getLogger("delay_risk_predictor")

MODULE_DIR = Path(__file__).resolve().parent
REPO_ROOT = MODULE_DIR.parent
DEFAULT_ARTIFACT_DIR = REPO_ROOT / "artifacts-delay_risk_model"
DEFAULT_MODEL_PATH = DEFAULT_ARTIFACT_DIR / "delay_risk_model.joblib"
DEFAULT_METADATA_PATH = DEFAULT_ARTIFACT_DIR / "delay_risk_metadata.json"
DEFAULT_HISTORY_PATH = DEFAULT_ARTIFACT_DIR / "history_reference.csv.gz"

CALENDAR_FEATURES = ["created_hour", "created_dow", "is_weekend", "created_month"]
CATEGORICAL_LOGICAL = ["priority", "category", "project", "country", "reporter"]
HISTORY_GROUPS = ["category", "project", "priority", "reporter"]
GLOBAL_PRIOR_FALLBACK = 0.5
RECENT_WINDOW_DAYS = 90
SMOOTHING = 20.0


def _patch_imputers(obj: Any) -> None:
    if hasattr(obj, "named_steps"):
        for step in obj.named_steps.values():
            _patch_imputers(step)
    if hasattr(obj, "transformers_"):
        for _, trans, _ in obj.transformers_:
            _patch_imputers(trans)
    if hasattr(obj, "steps"):
        for _, step in obj.steps:
            _patch_imputers(step)
    if hasattr(obj, "calibrated_classifiers_"):
        for cc in obj.calibrated_classifiers_:
            _patch_imputers(cc.estimator)
    if hasattr(obj, "_fit_dtype") and not hasattr(obj, "_fill_dtype"):
        obj._fill_dtype = obj._fit_dtype


def _parse_dt(s: pd.Series | Sequence[Any]) -> pd.Series:
    try:
        return pd.to_datetime(s, errors="coerce", utc=True, format="ISO8601")
    except (TypeError, ValueError):
        return pd.to_datetime(s, errors="coerce", utc=True)


def _history_block(t: np.ndarray, res: np.ndarray, known: np.ndarray, delayed: np.ndarray, recent_days: int = RECENT_WINDOW_DAYS) -> dict[str, np.ndarray]:
    created_before = np.searchsorted(t, t, side="left")
    c24 = created_before - np.searchsorted(t, t - np.timedelta64(24, "h"), side="left")
    c7d = created_before - np.searchsorted(t, t - np.timedelta64(7, "D"), side="left")

    res_ok = ~np.isnat(res)
    resolved_before = np.searchsorted(np.sort(res[res_ok]), t, side="left")
    open_now = np.clip(created_before - resolved_before, 0, None)

    kmask = ~np.isnat(known) & ~np.isnan(delayed)
    order = np.argsort(known[kmask], kind="mergesort")
    ks = known[kmask][order]
    cum = np.concatenate([[0.0], np.cumsum(delayed[kmask][order])])
    k = np.searchsorted(ks, t, side="left")
    k_lo = np.searchsorted(ks, t - np.timedelta64(recent_days, "D"), side="left")
    return {
        "open_now": open_now,
        "created_24h": c24,
        "created_7d": c7d,
        "n_known": k,
        "sum_delayed": cum[k],
        "n_recent": k - k_lo,
        "sum_recent": cum[k] - cum[k_lo],
    }


def _recent_log_hours(t: np.ndarray, res: np.ndarray, log_hrs: np.ndarray, recent_days: int = RECENT_WINDOW_DAYS):
    ok = ~np.isnat(res) & ~np.isnan(log_hrs)
    order = np.argsort(res[ok], kind="mergesort")
    rs = res[ok][order]
    cum = np.concatenate([[0.0], np.cumsum(log_hrs[ok][order])])
    k = np.searchsorted(rs, t, side="left")
    k_lo = np.searchsorted(rs, t - np.timedelta64(recent_days, "D"), side="left")
    return cum[k] - cum[k_lo], (k - k_lo).astype(float)


def _engineer_features(std_df: pd.DataFrame) -> pd.DataFrame:
    df = std_df.sort_values("created_ts", kind="mergesort").reset_index(drop=True).copy()
    n = len(df)

    df["created_hour"] = df["created_ts"].dt.hour
    df["created_dow"] = df["created_ts"].dt.dayofweek
    df["is_weekend"] = (df["created_dow"] >= 5).astype(int)
    df["created_month"] = df["created_ts"].dt.month

    for c in set(CATEGORICAL_LOGICAL + HISTORY_GROUPS):
        if c in df.columns:
            df[c] = df[c].fillna("missing").astype(str)

    groups = [c for c in HISTORY_GROUPS if c in df.columns]
    if "project" in df.columns and "category" in df.columns:
        df["project_category"] = df["project"] + "|" + df["category"]
        groups.append("project_category")
    if "project" in df.columns and "priority" in df.columns:
        df["project_priority"] = df["project"] + "|" + df["priority"]
        groups.append("project_priority")

    def _to_dt64(series: pd.Series) -> np.ndarray:
        s = pd.to_datetime(series, errors="coerce")
        if hasattr(s.dt, "tz") and s.dt.tz is not None:
            s = s.dt.tz_localize(None)
        return s.to_numpy(dtype="datetime64[ns]")

    t = _to_dt64(df["created_ts"])
    res = _to_dt64(df["resolved_ts"])
    kn = _to_dt64(df["known_ts"])
    delayed = pd.to_numeric(df["delayed"], errors="coerce").to_numpy(dtype=float)
    res_hrs = pd.to_numeric(df.get("resolution_hours", pd.Series(np.nan, index=df.index)), errors="coerce")
    log_hrs = np.log1p(res_hrs.to_numpy(dtype=float))

    g = _history_block(t, res, kn, delayed)
    prior_all = np.where(g["n_known"] > 0, g["sum_delayed"] / np.maximum(g["n_known"], 1), GLOBAL_PRIOR_FALLBACK)
    recent_all = (g["sum_recent"] + SMOOTHING * prior_all) / (g["n_recent"] + SMOOTHING)
    df["global_open_now"], df["global_created_24h"], df["global_created_7d"] = g["open_now"], g["created_24h"], g["created_7d"]
    df["global_delay_rate"], df["global_recent_rate"], df["global_recent_n"] = prior_all, recent_all, g["n_recent"]

    # Operational congestion & arrival surge
    daily_vel_all = np.maximum(g["created_7d"] / 7.0, 1.0)
    df["global_congestion_ratio"] = g["open_now"] / daily_vel_all
    df["global_surge_ratio"] = g["created_24h"] / daily_vel_all

    gs, gn = _recent_log_hours(t, res, log_hrs)
    glob_lh = np.where(gn > 0, gs / np.maximum(gn, 1), np.nan)
    glob_lh = pd.Series(glob_lh).ffill().bfill().fillna(0.0).to_numpy()
    df["global_recent_log_hrs"] = (gs + SMOOTHING * glob_lh) / (gn + SMOOTHING)

    for grp in groups:
        cols = {k: np.zeros(n) for k in ["open_now", "created_24h", "created_7d", "prior_n", "delay_rate", "recent_n", "recent_rate", "gap_hrs", "recent_log_hrs", "congestion_ratio", "surge_ratio"]}
        for _, ix in df.groupby(grp).indices.items():
            b = _history_block(t[ix], res[ix], kn[ix], delayed[ix])
            cols["open_now"][ix], cols["created_24h"][ix], cols["created_7d"][ix] = b["open_now"], b["created_24h"], b["created_7d"]
            cols["prior_n"][ix] = b["n_known"]
            cols["delay_rate"][ix] = (b["sum_delayed"] + SMOOTHING * prior_all[ix]) / (b["n_known"] + SMOOTHING)
            cols["recent_n"][ix] = b["n_recent"]
            cols["recent_rate"][ix] = (b["sum_recent"] + SMOOTHING * recent_all[ix]) / (b["n_recent"] + SMOOTHING)
            tg = t[ix]
            gap = np.full(len(ix), np.nan)
            if len(ix) > 1:
                gap[1:] = (tg[1:] - tg[:-1]) / np.timedelta64(1, "h")
            cols["gap_hrs"][ix] = gap
            s_, n_ = _recent_log_hours(tg, res[ix], log_hrs[ix])
            cols["recent_log_hrs"][ix] = (s_ + SMOOTHING * df["global_recent_log_hrs"].to_numpy()[ix]) / (n_ + SMOOTHING)
            grp_daily_vel = np.maximum(b["created_7d"] / 7.0, 1.0)
            cols["congestion_ratio"][ix] = b["open_now"] / grp_daily_vel
            cols["surge_ratio"][ix] = b["created_24h"] / grp_daily_vel
        for k, v in cols.items():
            df[f"{grp}_{k}"] = v

    return df


def _explain_rows(base_pipeline: Pipeline, X: pd.DataFrame, reference: dict[str, Any], background: pd.DataFrame) -> pd.DataFrame:
    base_p = base_pipeline.predict_proba(X)[:, 1]
    out = {}
    for col in X.columns:
        X_alt = X.copy()
        X_alt[col] = reference[col]
        out[col] = base_p - base_pipeline.predict_proba(X_alt)[:, 1]
    return pd.DataFrame(out, index=X.index)


class DelayRiskPredictor:
    def __init__(
        self,
        model_path: str | Path = DEFAULT_MODEL_PATH,
        history_path: str | Path = DEFAULT_HISTORY_PATH,
        metadata_path: str | Path = DEFAULT_METADATA_PATH,
    ) -> None:
        self.model_path = Path(model_path)
        self.history_path = Path(history_path)
        self.metadata_path = Path(metadata_path)
        self.bundle: dict[str, Any] | None = None
        self.metadata: dict[str, Any] = {}
        self.history_ref: pd.DataFrame | None = None
        self.load_error: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            if not self.model_path.exists():
                raise FileNotFoundError(f"Delay risk model artifact not found at {self.model_path}")
            if not self.history_path.exists():
                raise FileNotFoundError(f"Delay risk history reference not found at {self.history_path}")

            self.bundle = joblib.load(self.model_path)
            _patch_imputers(self.bundle.get("base_pipeline"))
            _patch_imputers(self.bundle.get("model"))

            if self.metadata_path.exists():
                self.metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))

            self.history_ref = pd.read_csv(self.history_path)
            for c in ("created_ts", "resolved_ts", "known_ts"):
                if c in self.history_ref.columns:
                    self.history_ref[c] = _parse_dt(self.history_ref[c])
            self.history_ref["_is_new"] = False
            logger.info("DelayRiskPredictor loaded successfully.")
        except Exception as exc:
            self.bundle = None
            self.history_ref = None
            self.load_error = str(exc)
            logger.error("Failed to load DelayRiskPredictor: %s", exc)

    @property
    def available(self) -> bool:
        return self.bundle is not None and self.history_ref is not None

    def predict(
        self,
        tickets: Mapping[str, Any] | Sequence[Mapping[str, Any]] | pd.DataFrame,
        *,
        threshold: float | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        if not self.available:
            raise RuntimeError(f"DelayRiskPredictor is unavailable: {self.load_error}")

        if isinstance(tickets, Mapping):
            raw_new = pd.DataFrame([tickets])
        elif isinstance(tickets, pd.DataFrame):
            raw_new = tickets.copy()
        elif isinstance(tickets, Sequence):
            raw_new = pd.DataFrame(list(tickets))
        else:
            raise TypeError("tickets must be a Mapping, Sequence of Mappings, or DataFrame")

        mp = self.bundle["mapping"]
        # Standardize column mappings
        col_created = mp.get("created", "issue_created")
        col_priority = mp.get("priority", "issue_priority")
        col_category = mp.get("category", "issue_type")
        col_project = mp.get("project", "issue_proj")
        col_reporter = mp.get("reporter", "issue_reporter")
        col_id = mp.get("ticket_id", "id")

        new_std = pd.DataFrame(index=raw_new.index)
        new_std["ticket_id"] = raw_new[col_id].astype(str) if col_id in raw_new.columns else [f"NEW-{i}" for i in range(len(raw_new))]
        new_std["created_ts"] = _parse_dt(raw_new[col_created] if col_created in raw_new.columns else raw_new.get("issue_created"))
        if new_std["created_ts"].isna().any():
            raise ValueError("Some tickets have invalid or missing creation timestamps.")

        new_std["priority"] = raw_new[col_priority].astype(str) if col_priority in raw_new.columns else "missing"
        new_std["category"] = raw_new[col_category].astype(str) if col_category in raw_new.columns else "missing"
        new_std["project"] = raw_new[col_project].astype(str) if col_project in raw_new.columns else "missing"
        new_std["reporter"] = raw_new[col_reporter].astype(str) if col_reporter in raw_new.columns else "missing"
        new_std["resolved_ts"] = pd.NaT
        new_std["resolution_hours"] = np.nan
        new_std["delayed"] = np.nan
        new_std["known_ts"] = pd.NaT
        new_std["_is_new"] = True

        combined = pd.concat([self.history_ref, new_std], ignore_index=True)
        feats = _engineer_features(combined)
        new_feats = feats[feats["_is_new"] == True].copy()

        feature_cols = self.bundle["feature_columns"]
        X = new_feats[feature_cols]

        proba = self.bundle["model"].predict_proba(X)[:, 1]
        op_threshold = float(threshold if threshold is not None else self.bundle.get("threshold", 0.1842))

        # Explanation via perturbation
        base_pipe = self.bundle["base_pipeline"]
        ref = self.bundle["reference"]
        bg = self.bundle["background"]
        impacts = _explain_rows(base_pipe, X, ref, bg)

        results = []
        for i, p in enumerate(proba):
            p_val = round(float(p), 4)
            row_imp = impacts.iloc[i]
            top_feats = row_imp.abs().sort_values(ascending=False).head(top_k)
            factors = [
                {
                    "feature": str(f),
                    "impact": round(float(row_imp[f]), 4),
                    "direction": "increases_risk" if row_imp[f] > 0 else "reduces_risk",
                }
                for f in top_feats.index
            ]

            risk_band = "high" if p_val >= 0.7 else ("medium" if p_val >= 0.4 else "low")
            results.append({
                "ticket_id": str(new_std.iloc[i]["ticket_id"]),
                "risk_probability": p_val,
                "risk_band": risk_band,
                "predicted_delayed": bool(p_val >= op_threshold),
                "threshold_used": op_threshold,
                "top_contributing_factors": factors,
                "model_id": "delay-risk",
                "model_version": self.bundle.get("model_version", "delay-risk-v3"),
                "delay_threshold_hours": self.bundle.get("threshold_hours", 720.0),
            })
        return results

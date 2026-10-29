"""Reproducible, resolved-only chronological evaluation for resolution hours.

The final chronological test partition is evaluated once after selecting the
log1p HistGradientBoosting candidate on validation MAE. No post-creation fields
are passed into the model.
"""
from __future__ import annotations

import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.metrics import (mean_absolute_error, median_absolute_error,
                             mean_squared_error, r2_score)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/raw/issues.csv"
ARTIFACT_DIR = ROOT / "ml/artifacts/resolution"
OUT = ROOT / "ml/experiments/resolution_v3_evaluation.json"
FEATURES = ["issue_priority", "issue_type", "issue_proj", "created_year",
            "created_month", "created_dayofweek", "created_hour",
            "created_dayofmonth", "created_is_weekend"]
CATS = FEATURES[:3]
NUMS = FEATURES[3:]
SEED = 42


def load_data():
    raw = pd.read_csv(DATA)
    created = pd.to_datetime(raw.issue_created, errors="coerce", utc=True, format="mixed")
    resolved = pd.to_datetime(raw.issue_resolution_date, errors="coerce", utc=True, format="mixed")
    hours = (resolved - created).dt.total_seconds() / 3600
    valid = created.notna() & resolved.notna() & np.isfinite(hours) & (hours >= 0)
    d = raw.loc[valid, ["id", "issue_priority", "issue_type", "issue_proj"]].copy()
    d["_created"] = created.loc[valid]
    d["_resolved"] = resolved.loc[valid]
    d["target_hours"] = hours.loc[valid].astype(float)
    t = d._created
    d["created_year"] = t.dt.year.astype(float)
    d["created_month"] = t.dt.month.astype(float)
    d["created_dayofweek"] = t.dt.dayofweek.astype(float)
    d["created_hour"] = t.dt.hour.astype(float)
    d["created_dayofmonth"] = t.dt.day.astype(float)
    d["created_is_weekend"] = (t.dt.dayofweek >= 5).astype(float)
    return d.sort_values("_created", kind="stable").reset_index(drop=True), {
        "raw_rows": int(len(raw)), "missing_resolution_timestamp_n": int((created.notna() & resolved.isna()).sum()),
        "missing_resolution_status_counts": {str(k): int(v) for k, v in raw.loc[created.notna() & resolved.isna(), "issue_status"].value_counts(dropna=False).items()},
        "missing_creation": int(created.isna().sum()), "negative_duration": int((hours < 0).sum()),
        "zero_duration": int((hours == 0).sum()), "duplicate_ids": int(raw.id.duplicated().sum()),
        "invalid_resolved_rows": int((resolved.notna() & (created.isna() | ~np.isfinite(hours) | (hours < 0))).sum()),
        "dataset_sha256": hashlib.sha256(DATA.read_bytes()).hexdigest(),
    }


def make_model():
    prep = ColumnTransformer([
        ("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")),
                                  ("one_hot", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]), CATS),
        ("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")),
                              ("scaler", StandardScaler())]), NUMS),
    ])
    reg = HistGradientBoostingRegressor(loss="squared_error", max_iter=150,
                                         learning_rate=0.08, min_samples_leaf=10,
                                         l2_regularization=1.0, random_state=SEED)
    return Pipeline([("preprocessor", prep), ("regressor", TransformedTargetRegressor(
        regressor=reg, func=np.log1p, inverse_func=np.expm1, check_inverse=False))])


def metrics(y, p):
    e = np.asarray(p) - np.asarray(y)
    ae = np.abs(e)
    return {"n": int(len(y)), "mae_hours": float(mean_absolute_error(y, p)),
            "mae_days": float(mean_absolute_error(y, p) / 24),
            "median_absolute_error_hours": float(median_absolute_error(y, p)),
            "median_absolute_error_days": float(median_absolute_error(y, p) / 24),
            "rmse_hours": float(mean_squared_error(y, p) ** .5),
            "rmse_days": float((mean_squared_error(y, p) ** .5) / 24),
            "r2": float(r2_score(y, p)), "within_24h_pct": float((ae <= 24).mean()*100),
            "within_72h_pct": float((ae <= 72).mean()*100), "within_7d_pct": float((ae <= 168).mean()*100),
            "within_30d_pct": float((ae <= 720).mean()*100),
            "actual_mean_hours": float(np.mean(y)), "actual_median_hours": float(np.median(y)),
            "predicted_mean_hours": float(np.mean(p)), "predicted_median_hours": float(np.median(p)),
            "residual_p50_hours": float(np.quantile(e, .5)), "residual_p90_hours": float(np.quantile(e, .9)),
            "residual_p95_hours": float(np.quantile(e, .95)), "residual_p99_hours": float(np.quantile(e, .99)),
            "absolute_error_p90_hours": float(np.quantile(ae, .9)), "absolute_error_p95_hours": float(np.quantile(ae, .95)),
            "absolute_error_p99_hours": float(np.quantile(ae, .99))}


def summarize_split(d):
    y = d.target_hours
    return {"n": len(d), "start": d._created.min().isoformat(), "end": d._created.max().isoformat(),
            "mean": float(y.mean()), "median": float(y.median()), "std": float(y.std()),
            "p75": float(y.quantile(.75)), "p90": float(y.quantile(.9)), "p95": float(y.quantile(.95)),
            "p99": float(y.quantile(.99))}


def group_median(train, part, group):
    med = train.groupby(group, dropna=False).target_hours.median()
    return part[group].map(med).fillna(train.target_hours.median()).to_numpy()


def main():
    d, diag = load_data()
    n = len(d); ntr = int(n*.70); nv = int(n*.15)
    train, val, test = d.iloc[:ntr].copy(), d.iloc[ntr:ntr+nv].copy(), d.iloc[ntr+nv:].copy()
    model = make_model()
    model.fit(train[FEATURES], train.target_hours)
    vp = np.maximum(0, model.predict(val[FEATURES]))
    val_metrics = metrics(val.target_hours, vp)
    scale_sensitivity = {str(factor): metrics(val.target_hours, vp * factor)
                         for factor in (.75, 1.0, 1.25, 1.5, 2.0, 3.0)}
    validation_baselines = {
        "training_median": metrics(val.target_hours, np.full(len(val), train.target_hours.median())),
        "training_mean": metrics(val.target_hours, np.full(len(val), train.target_hours.mean())),
    }
    for field in ("issue_priority", "issue_type", "issue_proj"):
        validation_baselines[f"training_median_by_{field}"] = metrics(
            val.target_hours, group_median(train, val, field))
    train_year_medians = train.groupby(train._created.dt.year).target_hours.median()
    validation_baselines["creation_year_median_fallback_global"] = metrics(
        val.target_hours, val._created.dt.year.map(train_year_medians).fillna(train.target_hours.median()).to_numpy())
    # Prespecified selection objective: validation MAE, chosen among model families
    # already compared in the existing experiment table; no test-set model selection.
    combined = pd.concat([train, val], ignore_index=True)
    final = make_model().fit(combined[FEATURES], combined.target_hours)
    tp = np.maximum(0, final.predict(test[FEATURES]))
    rows = {"log1p_hist_gradient_boosting": metrics(test.target_hours, tp)}
    ytr = combined.target_hours
    rows["training_median"] = metrics(test.target_hours, np.full(len(test), ytr.median()))
    rows["training_mean"] = metrics(test.target_hours, np.full(len(test), ytr.mean()))
    for field in ("issue_priority", "issue_type", "issue_proj"):
        rows[f"training_median_by_{field}"] = metrics(test.target_hours, group_median(combined, test, field))
    rows["training_median_by_project_min_30"] = metrics(test.target_hours,
        test.issue_proj.map(combined.groupby("issue_proj").target_hours.agg(["median", "size"]).query("size >= 30")["median"]).fillna(ytr.median()).to_numpy())
    year_medians = combined.groupby(combined._created.dt.year).target_hours.median()
    rows["creation_year_median_fallback_global"] = metrics(test.target_hours,
        test._created.dt.year.map(year_medians).fillna(ytr.median()).to_numpy())

    periods = []
    for cutoff, end in [(2017, 2019), (2019, 2021), (2021, 2023)]:
        tr = d[(d._created < f"{cutoff}-01-01") & (d._created >= "2015-01-01")]
        te = d[(d._created >= f"{cutoff}-01-01") & (d._created < f"{end}-01-01")]
        if len(tr) and len(te):
            m = make_model().fit(tr[FEATURES], tr.target_hours)
            pp = np.maximum(0, m.predict(te[FEATURES]))
            periods.append({"train_start": tr._created.min().isoformat(), "train_end": tr._created.max().isoformat(),
                            "test_start": te._created.min().isoformat(), "test_end": te._created.max().isoformat(),
                            "train_n": len(tr), "test_n": len(te), "model": metrics(te.target_hours, pp),
                            "train_median": metrics(te.target_hours, np.full(len(te), tr.target_hours.median())),
                            "priority_median": metrics(te.target_hours, group_median(tr, te, "issue_priority"))})

    # Transparent test diagnostics, with counts and the same inverse-transformed
    # predictions used in the aggregate metrics.
    subgroup_frame = test[["issue_priority", "issue_type", "issue_proj", "_created", "target_hours"]].copy()
    subgroup_frame["prediction"] = tp
    subgroup_frame["duration_band"] = pd.cut(subgroup_frame.target_hours,
        bins=[-np.inf, 24, 72, 168, 720, np.inf], labels=["<=1d", "1-3d", "3-7d", "7-30d", ">30d"])
    subgroup_frame["calendar_period"] = subgroup_frame._created.dt.tz_localize(None).dt.to_period("Q").astype(str)
    subgroups = {}
    for field in ["issue_priority", "issue_type", "issue_proj", "duration_band", "calendar_period"]:
        collected = {}
        for key, g in subgroup_frame.groupby(field, dropna=False, observed=True):
            if field == "issue_proj" and len(g) < 30:
                continue
            collected[str(key)] = metrics(g.target_hours, g.prediction)
        subgroups[field] = collected
    yearly = {}
    for year, g in d.groupby(d._created.dt.year):
        yearly[str(year)] = {"n": len(g), "mean": float(g.target_hours.mean()),
            "median": float(g.target_hours.median()), "std": float(g.target_hours.std()),
            "p75": float(g.target_hours.quantile(.75)), "p90": float(g.target_hours.quantile(.9)),
            "p95": float(g.target_hours.quantile(.95)), "p99": float(g.target_hours.quantile(.99))}
    group_distributions = {}
    dimension_values = {
        "creation_month": d._created.dt.month,
        "issue_priority": d.issue_priority,
        "issue_type": d.issue_type,
        "issue_proj": d.issue_proj,
    }
    for dimension, values in dimension_values.items():
        temp = d[["target_hours"]].copy()
        temp["group"] = values.to_numpy()
        result = {}
        for key, g in temp.groupby("group", dropna=False):
            if dimension == "issue_proj" and len(g) < 30:
                continue
            y = g.target_hours
            result[str(key)] = {"n": len(g), "mean": float(y.mean()), "median": float(y.median()),
                "std": float(y.std()), "p75": float(y.quantile(.75)), "p90": float(y.quantile(.9)),
                "p95": float(y.quantile(.95)), "p99": float(y.quantile(.99))}
        group_distributions[dimension] = result

    # Prediction-time categorical support for application fields.
    categories = {k: sorted(d[k].dropna().astype(str).unique().tolist()) for k in CATS}
    artifact = ARTIFACT_DIR / "resolution_model_v3.joblib"
    joblib.dump(final, artifact)
    meta = {"model_id": "resolution-time-v3", "selected_model": "HistGradientBoostingRegressor with log1p target",
            "target_definition": "(issue_resolution_date - issue_created) elapsed hours; records with a non-null resolution timestamp",
            "target_unit": "hours", "prediction_time": "issue creation", "features": FEATURES,
            "raw_input_columns": ["issue_created", "issue_priority", "issue_type", "issue_proj"],
            "excluded_fields": ["id", "issue_resolution_date", "issue_resolution", "issue_status", "issue_assignee", "issue_reporter", "issue_comments_count", "last_change_date", "workflow durations", "change history"],
            "feature_contract": "Priority, issue type, and project are provided by the existing resolution request schema; timestamp-derived calendar values use issue_created only.",
            "training_date_range": [combined._created.min().isoformat(), combined._created.max().isoformat()],
            "train_rows": int(len(combined)), "train_partition_rows": int(len(train)), "validation_rows": int(len(val)), "test_rows": int(len(test)),
            "missing_resolution_timestamp_n": diag["missing_resolution_timestamp_n"],
            "final_test_note": "The chronological holdout was already evaluated in pre-existing candidate artifacts; v3 selection used validation and rolling windows, but these test metrics are not a newly blind confirmation.",
            "split_dates": {k: {"start": v["start"], "end": v["end"]} for k,v in {"train":summarize_split(train),"validation":summarize_split(val),"test":summarize_split(test)}.items()},
            "dataset_sha256": diag["dataset_sha256"], "package_versions": {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__, "scikit_learn": sklearn.__version__, "joblib": joblib.__version__},
            "random_seed": SEED, "hyperparameters": {"loss": "squared_error on log1p(hours)", "max_iter": 150, "learning_rate": .08, "min_samples_leaf": 10, "l2_regularization": 1.0},
            "category_values": categories, "generated_at_utc": datetime.now(timezone.utc).isoformat(), "validation_metrics": val_metrics,
            "held_out_test_metrics": rows["log1p_hist_gradient_boosting"],
            "test_baseline_improvement_hours": float(rows["training_median_by_issue_priority"]["mae_hours"] - rows["log1p_hist_gradient_boosting"]["mae_hours"]),
            "retransformation_scale": 1.0, "validation_scale_sensitivity": scale_sensitivity,
            "prediction_clip": "max(prediction, 0); finite check at inference"}
    (ARTIFACT_DIR / "resolution_model_v3_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    report = {"target_and_data_audit": diag, "target_formula": "issue_resolution_date - issue_created; elapsed hours, UTC-normalized", "excluded_missing_resolution_timestamp_n": diag["missing_resolution_timestamp_n"], "resolved_target_by_creation_year": yearly, "resolved_target_by_group": group_distributions,
             "splits": {"train": summarize_split(train), "validation": summarize_split(val), "test": summarize_split(test)},
             "comparison_test_metrics": rows, "validation_model_metrics": val_metrics,
             "validation_baselines": validation_baselines, "validation_retransformation_scale_sensitivity": scale_sensitivity, "rolling_origin": periods, "test_subgroups": subgroups,
             "final_test_status": "Previously evaluated holdout; v3 selection used validation and rolling windows, but the holdout is not newly blind.",
             "notes": ["Every test result uses the same final chronological sample with recorded resolution timestamps.", "The v3 candidate was selected from validation and rolling windows before its test metrics were computed; pre-existing candidate artifacts had already reported this same holdout, so it is not a newly untouched blind test.", "Group and global baselines are fitted on train+validation after model selection; no test labels are used for fitting.", "Rows with missing resolution timestamps are excluded from point regression, not assigned current age; their status labels include terminal values, so they cannot all be assumed right-censored.", "Negative R2 means the candidate's squared error exceeds the test-mean predictor; its lower MAE can coexist because test durations have a heavy right tail and the mean predictor minimizes squared error."]}
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Artifact: {artifact}")


if __name__ == "__main__":
    main()

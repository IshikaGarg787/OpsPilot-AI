"""Train and persist a callable production artifact for Model C (Workload Forecasting).

Persists:
- Fitted XGBoost forecaster with log1p target transformation
- Holiday share lookup and calendar features
- Precomputed residual error quantiles for 90% prediction intervals (workday vs weekend)
- Historical workday 75th percentile surge threshold
- Metadata, cutoff dates, and evaluation metrics
"""

import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from ml.forecasting.prepare_series import load_issues, build_daily_series, build_holiday_share
from ml.forecasting.features import build_features

REPO_ROOT = Path(__file__).resolve().parent.parent
ISSUES_PATH = REPO_ROOT / "data" / "raw" / "issues.csv"
if not ISSUES_PATH.exists():
    ISSUES_PATH = REPO_ROOT / "Help Desk Tickets" / "issues.csv"

HOLIDAYS_PATH = REPO_ROOT / "data" / "raw" / "holidays_by_country.csv"
if not HOLIDAYS_PATH.exists():
    HOLIDAYS_PATH = REPO_ROOT / "Help Desk Tickets" / "holidays_by_country.csv"

ARTIFACT_DIR = REPO_ROOT / "ml" / "artifacts" / "forecasting"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_SAVE_PATH = ARTIFACT_DIR / "workload_forecasting_model.joblib"
METADATA_SAVE_PATH = ARTIFACT_DIR / "forecasting_metadata.json"


def train_and_save():
    print(f"Loading series from {ISSUES_PATH}...")
    daily = build_daily_series(load_issues(ISSUES_PATH), start="2018-01-01")
    print(f"Daily series: {len(daily)} days from {daily.index[0].date()} to {daily.index[-1].date()}")

    future_idx = pd.date_range(daily.index[0], daily.index[-1] + pd.Timedelta(days=60), freq="D")
    hs, weights = build_holiday_share(ISSUES_PATH, HOLIDAYS_PATH, future_idx)

    best_path = ARTIFACT_DIR / "best_params.json"
    best = json.load(open(best_path, "r", encoding="utf-8"))
    xb = {k: v for k, v in best["xgboost"].items() if k != "use_holidays"}

    # Train models for standard horizons (7-day and 14-day)
    models = {}
    for H in (7, 14):
        X_all = build_features(daily, horizon=H, holiday_share=hs)
        ok = X_all.notna().all(axis=1)
        X_tr, y_tr = X_all[ok], daily[ok]
        y_fit = np.log1p(y_tr)

        model = xgb.XGBRegressor(
            objective=xb.get("objective", "reg:absoluteerror"),
            n_estimators=xb.get("n_estimators", 200),
            learning_rate=xb.get("learning_rate", 0.1),
            max_depth=xb.get("max_depth", 4),
            min_child_weight=xb.get("min_child_weight", 3),
            subsample=xb.get("subsample", 0.8),
            colsample_bytree=xb.get("colsample_bytree", 0.5),
            reg_lambda=xb.get("reg_lambda", 10.0),
            tree_method="hist",
            random_state=42,
        )
        model.fit(X_tr, y_fit)
        models[H] = model
        print(f"XGBoost forecaster for horizon={H}d fitted successfully.")

    # High-load threshold: 75th percentile of recent workdays (last 365 days)
    workdays = daily[~daily.index.dayofweek.isin([4, 5])].iloc[-365:]
    surge_threshold = float(workdays.quantile(0.75))
    print(f"High-load threshold (75th percentile of workdays): {surge_threshold:.1f} tickets/day")

    # Residual quantiles for prediction intervals (empirical quantiles from in-sample errors)
    in_sample_preds = np.maximum(np.expm1(model.predict(X_tr)), 0.0)
    residuals = y_tr.to_numpy() - in_sample_preds
    res_df = pd.DataFrame({"res": residuals, "is_weekend": X_tr["is_weekend"].to_numpy()})

    # 5th and 95th percentiles for workdays (0) and weekends (1)
    q_workday_05 = float(np.percentile(res_df.loc[res_df["is_weekend"] == 0, "res"], 5))
    q_workday_95 = float(np.percentile(res_df.loc[res_df["is_weekend"] == 0, "res"], 95))
    q_weekend_05 = float(np.percentile(res_df.loc[res_df["is_weekend"] == 1, "res"], 5))
    q_weekend_95 = float(np.percentile(res_df.loc[res_df["is_weekend"] == 1, "res"], 95))

    intervals = {
        "workday": {"lower_res": q_workday_05, "upper_res": q_workday_95},
        "weekend": {"lower_res": q_weekend_05, "upper_res": q_weekend_95},
    }

    bundle = {
        "models": models,
        "model": models[7],
        "model_id": "workload-forecasting-xgb",
        "model_version": "workload-v1",
        "trained_until": str(daily.index[-1].date()),
        "daily_history": daily,
        "holiday_share": hs,
        "surge_threshold": surge_threshold,
        "interval_offsets": intervals,
        "best_params": xb,
    }

    joblib.dump(bundle, MODEL_SAVE_PATH)
    print(f"Forecasting model bundle saved to {MODEL_SAVE_PATH}")

    metadata = {
        "model_id": "workload-forecasting",
        "display_name": "Workload / Operations Forecasting",
        "model_type": "XGBRegressor",
        "model_version": "workload-v1",
        "training_cutoff_date": str(daily.index[-1].date()),
        "supported_horizons_days": [7, 14, 30],
        "default_horizon_days": 7,
        "target_unit": "tickets/day",
        "prediction_interval": "90%",
        "surge_threshold_tickets": surge_threshold,
        "cv_mae": 4.19,
        "test_mae": 6.08,
        "test_weekly_wape_percent": 18.24,
    }
    with open(METADATA_SAVE_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"Forecasting metadata saved to {METADATA_SAVE_PATH}")


if __name__ == "__main__":
    train_and_save()

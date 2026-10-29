import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from ml.forecasting.features import build_features
from ml.forecasting.prepare_series import (
    build_daily_series,
    build_holiday_share,
    load_issues,
)


ROOT = Path(__file__).resolve().parents[2]

ISSUES_PATH = ROOT / "data" / "raw" / "issues.csv"
HOLIDAYS_PATH = ROOT / "data" / "raw" / "holidays_by_country.csv"
ARTIFACT_DIR = ROOT / "ml" / "artifacts" / "forecasting"
PARAMS_PATH = ARTIFACT_DIR / "best_params.json"
MODEL_PATH = ARTIFACT_DIR / "workload_xgboost.joblib"

START_DATE = "2018-01-01"
HORIZONS = (7, 14)


def main():
    if not ISSUES_PATH.exists():
        raise FileNotFoundError(f"Ticket data not found: {ISSUES_PATH}")

    if not HOLIDAYS_PATH.exists():
        raise FileNotFoundError(f"Holiday data not found: {HOLIDAYS_PATH}")

    if not PARAMS_PATH.exists():
        raise FileNotFoundError(
            f"Tuned parameters not found: {PARAMS_PATH}\n"
            "Run: python -m ml.forecasting.tune"
        )

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    daily = build_daily_series(
        load_issues(ISSUES_PATH),
        start=START_DATE,
    )

    params = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
    configs = params.get("xgboost_top5") or [params["xgboost"]]

    future_index = pd.date_range(
        start=daily.index[0],
        end=daily.index[-1] + pd.Timedelta(days=30),
        freq="D",
    )

    holiday_share, _ = build_holiday_share(
        str(ISSUES_PATH),
        str(HOLIDAYS_PATH),
        future_index,
        weights_until=daily.index[-1] + pd.Timedelta(days=1),
    )

    models_by_horizon = {}

    for horizon in HORIZONS:
        all_features = build_features(
            daily,
            horizon=horizon,
            holiday_share=holiday_share,
        )

        valid_rows = all_features.notna().all(axis=1)
        X_all = all_features.loc[valid_rows]
        y_all = daily.loc[valid_rows]

        candidates = []

        for config_number, original_config in enumerate(configs, start=1):
            config = dict(original_config)

            use_holidays = bool(config.pop("use_holidays", False))
            train_days = config.pop("train_days", None)
            log_target = bool(config.pop("log_target", False))

            X_train = X_all.copy()
            y_train = y_all.copy()

            if train_days:
                X_train = X_train.iloc[-int(train_days):]
                y_train = y_train.iloc[-int(train_days):]

            model = xgb.XGBRegressor(
                objective=config.get("objective", "reg:squarederror"),
                n_estimators=int(config.get("n_estimators", 300)),
                learning_rate=float(config.get("learning_rate", 0.05)),
                max_depth=int(config.get("max_depth", 4)),
                min_child_weight=float(config.get("min_child_weight", 5)),
                subsample=float(config.get("subsample", 0.8)),
                colsample_bytree=float(config.get("colsample_bytree", 0.8)),
                reg_lambda=float(config.get("reg_lambda", 1.0)),
                tree_method="hist",
                n_jobs=2,
                random_state=42,
                verbosity=0,
            )

            target = np.log1p(y_train) if log_target else y_train
            model.fit(X_train, target)

            candidates.append({
                "model": model,
                "log_target": log_target,
                "uses_holidays": use_holidays,
                "feature_columns": list(X_train.columns),
                "config_number": config_number,
            })

            print(
                f"Trained candidate {config_number}/{len(configs)} "
                f"for {horizon}-day forecast."
            )

        models_by_horizon[horizon] = candidates

    bundle = {
        "model_name": "xgboost_tuned_top5",
        "trained_through": str(daily.index[-1].date()),
        "horizons": models_by_horizon,
        "daily_history": daily,
        "holiday_share": holiday_share,
        "start_date": START_DATE,
    }

    joblib.dump(bundle, MODEL_PATH)

    print(f"\nModel saved to:\n{MODEL_PATH}")
    print(f"Training data ends on: {bundle['trained_through']}")


if __name__ == "__main__":
    main()
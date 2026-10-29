"""Workload Forecasting Inference Engine (Model C).

Loads the persisted XGBoost forecasting model artifact and generates
live multi-day ticket volume forecasts with:
- Daily arrival point estimates (tickets/day)
- 90% empirical prediction intervals (lower_90, upper_90)
- Weekday names and high-load anomaly flags
- Weekly staffing totals (aggregated expected arrivals)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.forecasting.features import build_features

logger = logging.getLogger("forecasting_predictor")

MODULE_DIR = Path(__file__).resolve().parent
REPO_ROOT = MODULE_DIR.parent
DEFAULT_ARTIFACT_PATH = MODULE_DIR / "artifacts" / "forecasting" / "workload_forecasting_model.joblib"
DEFAULT_METADATA_PATH = MODULE_DIR / "artifacts" / "forecasting" / "forecasting_metadata.json"


class WorkloadForecastingPredictor:
    def __init__(
        self,
        artifact_path: str | Path = DEFAULT_ARTIFACT_PATH,
        metadata_path: str | Path = DEFAULT_METADATA_PATH,
    ) -> None:
        self.artifact_path = Path(artifact_path)
        self.metadata_path = Path(metadata_path)
        self.bundle: dict[str, Any] | None = None
        self.metadata: dict[str, Any] = {}
        self.load_error: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            if not self.artifact_path.exists():
                raise FileNotFoundError(f"Forecasting model artifact not found at {self.artifact_path}")
            self.bundle = joblib.load(self.artifact_path)
            if self.metadata_path.exists():
                self.metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            logger.info("WorkloadForecastingPredictor loaded successfully.")
        except Exception as exc:
            self.bundle = None
            self.load_error = str(exc)
            logger.error("Failed to load WorkloadForecastingPredictor: %s", exc)

    @property
    def available(self) -> bool:
        return self.bundle is not None

    def predict_forecast(self, horizon: int = 7) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError(f"WorkloadForecastingPredictor is unavailable: {self.load_error}")

        if horizon not in (7, 14, 21, 28, 30):
            if horizon < 1 or horizon > 60:
                raise ValueError("horizon must be an integer between 1 and 60 days.")

        daily = self.bundle["daily_history"]
        hs = self.bundle["holiday_share"]
        surge_thr = self.bundle["surge_threshold"]
        interval_offsets = self.bundle["interval_offsets"]

        model_horizon = 14 if horizon > 7 else 7
        models_dict = self.bundle.get("models", {})
        model = models_dict.get(model_horizon, self.bundle.get("model"))

        # Build future dates immediately following the last observed date
        start_date = daily.index[-1] + pd.Timedelta(days=1)
        future_idx = pd.date_range(start_date, periods=horizon, freq="D")

        ext = daily.reindex(daily.index.append(future_idx))
        X_f = build_features(ext, horizon=model_horizon, holiday_share=hs).loc[future_idx]

        log_preds = model.predict(X_f)
        preds = np.maximum(np.expm1(log_preds), 0.0)

        daily_items = []
        total_forecast = 0.0
        for i, dt in enumerate(future_idx):
            f_val = round(float(preds[i]), 1)
            total_forecast += f_val
            is_wknd = dt.dayofweek in [4, 5]
            offsets = interval_offsets["weekend" if is_wknd else "workday"]
            lower_90 = round(float(np.maximum(f_val + offsets["lower_res"], 0.0)), 1)
            upper_90 = round(float(f_val + offsets["upper_res"]), 1)
            high_load = bool(f_val >= surge_thr)

            daily_items.append({
                "date": dt.strftime("%Y-%m-%d"),
                "weekday": dt.day_name(),
                "forecast": f_val,
                "lower_90": lower_90,
                "upper_90": upper_90,
                "high_load_flag": high_load,
                "high_load_threshold": surge_thr,
            })

        return {
            "model_id": "workload-forecasting",
            "model_version": self.bundle.get("model_version", "workload-v1"),
            "training_cutoff_date": self.bundle.get("trained_until"),
            "horizon_days": horizon,
            "unit": "tickets/day",
            "weekly_total_tickets": round(total_forecast, 1) if horizon == 7 else round(sum(d["forecast"] for d in daily_items[:7]), 1),
            "forecast_period": {
                "start": future_idx[0].strftime("%Y-%m-%d"),
                "end": future_idx[-1].strftime("%Y-%m-%d"),
            },
            "high_load_threshold": surge_thr,
            "forecasts": daily_items,
        }

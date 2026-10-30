"""FastAPI adapter for the existing resolution-time regression artifact.

This service only loads the persisted pipeline and performs inference. It never
trains or mutates the artifact at startup.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from ml.model_auth import require_model_token

from .resolution_predictor import DEFAULT_ARTIFACT_PATH, load_resolution_pipeline, predict_resolution_time_with_pipeline


MODULE_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = Path(os.getenv("ML_ARTIFACT_DIR", str(MODULE_DIR / "artifacts" / "resolution")))
MODEL_PATH = Path(os.getenv("ML_MODEL_PATH", str(ARTIFACT_DIR / "resolution_model.joblib")))
METADATA_PATH = ARTIFACT_DIR / "metadata.json"
METRICS_PATH = ARTIFACT_DIR / "metrics.json"


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_created: str = Field(min_length=1, max_length=100)
    issue_priority: str = Field(min_length=1, max_length=100)
    issue_type: str = Field(min_length=1, max_length=100)
    issue_proj: str = Field(min_length=1, max_length=200)


class ModelRuntime:
    def __init__(self) -> None:
        self.pipeline: Any | None = None
        self.metadata: dict[str, Any] = {}
        self.metrics: dict[str, Any] = {}
        self.load_error: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            if not MODEL_PATH.exists():
                raise FileNotFoundError(f"Resolution model artifact not found at {MODEL_PATH}")
            self.pipeline = load_resolution_pipeline(MODEL_PATH)
            self.metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8")) if METADATA_PATH.exists() else {}
            self.metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8")) if METRICS_PATH.exists() else {}
        except Exception as exc:  # health endpoint exposes a safe status, not the filesystem detail
            self.pipeline = None
            self.load_error = str(exc)

    @property
    def available(self) -> bool:
        return self.pipeline is not None

    def model_version(self) -> str:
        explicit = self.metadata.get("model_version")
        if explicit:
            return str(explicit)
        generated = self.metadata.get("generated_at_utc")
        return f"resolution-time@{generated}" if generated else "resolution-time"

    def categories(self) -> dict[str, list[str]]:
        if self.pipeline is None:
            return {"issue_priority": [], "issue_type": [], "issue_proj": []}
        try:
            encoder = self.pipeline.named_steps["preprocessor"].named_transformers_["categorical"].named_steps["one_hot"]
            return {
                "issue_priority": [str(value) for value in encoder.categories_[0]],
                "issue_type": [str(value) for value in encoder.categories_[1]],
                "issue_proj": [str(value) for value in encoder.categories_[2]],
            }
        except (AttributeError, KeyError, IndexError) as exc:
            raise RuntimeError("The resolution artifact does not expose its categorical schema") from exc

    def ensure_available(self) -> None:
        if not self.available:
            raise HTTPException(status_code=503, detail="The resolution model artifact is unavailable.")

    def validate_categories(self, request: PredictionRequest) -> None:
        if self.pipeline is None:
            self.ensure_available()
        try:
            encoder = self.pipeline.named_steps["preprocessor"].named_transformers_["categorical"].named_steps["one_hot"]
        except (AttributeError, KeyError, IndexError) as exc:
            raise RuntimeError("The resolution artifact does not expose its categorical schema") from exc

        # The trained encoder uses handle_unknown="ignore". Rejecting unseen
        # values here contradicted the model contract and blocked real tickets
        # whose priority/project are valid operationally but absent from training.
        if getattr(encoder, "handle_unknown", "error") == "ignore":
            return

        categories = self.categories()
        values = request.model_dump()
        invalid = [field for field in ("issue_priority", "issue_type", "issue_proj") if values[field] not in categories[field]]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Unsupported model input value for: {', '.join(invalid)}")

    def metadata_response(self) -> dict[str, Any]:
        self.ensure_available()
        raw_inputs = self.metadata.get("raw_input_columns", ["issue_created", "issue_priority", "issue_type", "issue_proj"])
        engineered = self.metadata.get("engineered_features", [])
        categories = self.categories()
        return {
            "status": "available",
            "model_id": "resolution-time",
            "display_name": "Resolution-Time Prediction",
            "model_name": self.metadata.get("selected_model"),
            "model_version": self.model_version(),
            "artifact_generated_at": self.metadata.get("generated_at_utc"),
            "raw_input_columns": raw_inputs,
            "engineered_features": engineered,
            "prediction_type": self.metadata.get("prediction_type", "point_estimate"),
            "target_unit": self.metadata.get("target_unit", "hours"),
            "fields": {
                "issue_priority": {"label": "Priority", "required": True, "options": categories["issue_priority"]},
                "issue_type": {"label": "Issue type", "required": True, "options": categories["issue_type"]},
                "issue_proj": {"label": "Project", "required": True, "options": categories["issue_proj"]},
            },
            "evaluation": {
                "target": self.metrics.get("target"),
                "splits": self.metrics.get("splits"),
                "validation": self.metrics.get("validation_model_selection", {}).get("best_validation_row"),
                "final_test": self.metrics.get("final_test"),
                "test_median_baseline": self.metrics.get("test_median_baseline"),
                "test_baseline_improvement_hours": self.metrics.get("test_baseline_improvement_hours"),
            },
        }

    def predict(self, request: PredictionRequest) -> dict[str, Any]:
        self.ensure_available()
        self.validate_categories(request)
        try:
            result = predict_resolution_time_with_pipeline(self.pipeline, request.model_dump())
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not isinstance(result, dict) or not isinstance(result.get("duration"), (int, float)):
            raise HTTPException(status_code=503, detail="The resolution model returned an invalid result.")
        return {
            "model_id": "resolution-time",
            "duration": float(result["duration"]),
            "unit": "hours",
            "prediction_type": "point_estimate",
            "model_version": self.model_version(),
            "artifact_generated_at": self.metadata.get("generated_at_utc"),
        }


runtime = ModelRuntime()
app = FastAPI(title="OpsPilot AI ML Services", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    if not runtime.available:
        raise HTTPException(status_code=503, detail="The resolution model is unavailable.")
    return {"status": "available", "service": "resolution-time", "model_id": "resolution-time"}


@app.get("/metadata")
def metadata() -> dict[str, Any]:
    return runtime.metadata_response()


@app.post("/predict/resolution-time")
def predict(request: PredictionRequest, _auth: None = Depends(require_model_token)) -> dict[str, Any]:
    return runtime.predict(request)


# ---------------------------------------------------------------------------
# Live workload forecasting
# ---------------------------------------------------------------------------
from datetime import datetime, timezone
from ml.forecasting.features import build_features

FORECAST_PARAMS_PATH = MODULE_DIR / "artifacts" / "forecasting" / "best_params.json"
FORECAST_MODEL_PATH = MODULE_DIR / "artifacts" / "forecasting" / "workload_xgboost.joblib"

class WorkloadRecord(BaseModel):
    model_config = ConfigDict(extra="allow")
    issue_created: str | None = None
    date: str | None = None
    ticket_count: float | None = None
    issue_type: str | None = None

class WorkloadForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    records: list[WorkloadRecord] = Field(min_length=120, max_length=250000)
    horizon: Literal[7, 14] = 7


@lru_cache(maxsize=1)
def _forecast_configs() -> list[dict[str, Any]]:
    if not FORECAST_PARAMS_PATH.exists():
        raise FileNotFoundError("Forecasting model parameters are missing")
    params = json.loads(FORECAST_PARAMS_PATH.read_text(encoding="utf-8"))
    configs = params.get("xgboost_top5")
    if not isinstance(configs, list) or not configs:
        fallback = params.get("xgboost")
        if not isinstance(fallback, dict):
            raise ValueError("No usable XGBoost configuration was found")
        configs = [fallback]
    if not all(isinstance(config, dict) for config in configs):
        raise ValueError("XGBoost configurations must be JSON objects")
    return configs


def _live_daily_series(records):
    import numpy as np
    import pandas as pd
    from ml.forecasting.prepare_series import SUPPORT_TYPES

    frame = pd.DataFrame([r.model_dump() for r in records])
    if {"date", "ticket_count"}.issubset(frame.columns) and frame["date"].notna().any():
        frame["date"] = pd.to_datetime(frame["date"], utc=True, errors="coerce").dt.tz_convert(None).dt.normalize()
        frame["ticket_count"] = pd.to_numeric(frame["ticket_count"], errors="coerce")
        if frame["date"].isna().any() or frame["ticket_count"].isna().any():
            raise ValueError("Every daily aggregate row must contain a valid date and ticket_count")
        counts = frame["ticket_count"].to_numpy(dtype="float64")
        if not np.isfinite(counts).all():
            raise ValueError("ticket_count must be a finite number")
        if (counts < 0).any():
            raise ValueError("ticket_count must be zero or greater")
        if not np.equal(counts, np.floor(counts)).all():
            raise ValueError("ticket_count must contain whole ticket counts")
        daily = frame.groupby("date")["ticket_count"].sum().sort_index()
    else:
        created_col = "issue_created" if "issue_created" in frame.columns else None
        if not created_col or frame[created_col].notna().sum() == 0:
            raise ValueError("CSV must contain either date,ticket_count or issue_created columns")
        frame[created_col] = pd.to_datetime(frame[created_col], utc=True, errors="coerce")
        if frame[created_col].isna().any():
            raise ValueError("Every ticket row must contain a valid issue_created timestamp")
        if "issue_type" in frame.columns:
            frame = frame[frame["issue_type"].isin(SUPPORT_TYPES)]
        dates = frame[created_col].dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
        daily = dates.value_counts().sort_index()
    if daily.empty:
        raise ValueError("No valid ticket records were found in the uploaded data")
    start, end = daily.index.min(), daily.index.max()
    if (end - start).days < 119:
        raise ValueError("At least 120 days of dated ticket history are required for a reliable forecast")
    full_index = pd.date_range(start, end, freq="D")
    daily = daily.reindex(full_index, fill_value=0).astype(float)
    daily.index.name = "date"
    return daily


def _live_xgb_forecast(daily, horizon):
    import numpy as np
    import xgboost as xgb
    import pandas as pd

    configs = _forecast_configs()
    # The notebook's leakage-safe lag/rolling feature builder is reused. Every
    # candidate is refit on the latest uploaded history; no stale forecast CSV is used.
    future_idx = pd.date_range(daily.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")
    extended = daily.reindex(daily.index.append(future_idx))
    forecasts = []
    for original in configs:
        cfg = dict(original)
        cfg.pop("use_holidays", None)  # no holiday calendar is supplied by the live upload contract
        train_days = cfg.pop("train_days", None)
        log_target = bool(cfg.pop("log_target", False))
        features = build_features(daily, horizon=horizon, holiday_share=None)
        y = daily.copy()
        if train_days:
            features, y = features.iloc[-int(train_days):], y.iloc[-int(train_days):]
        valid = features.notna().all(axis=1)
        X_train, y_train = features.loc[valid], y.loc[valid]
        if len(X_train) < 30:
            raise ValueError("Not enough valid feature rows after preparing the history")
        model = xgb.XGBRegressor(
            objective=cfg.get("objective", "reg:squarederror"),
            n_estimators=int(cfg.get("n_estimators", 200)),
            learning_rate=float(cfg.get("learning_rate", 0.1)),
            max_depth=int(cfg.get("max_depth", 4)),
            min_child_weight=float(cfg.get("min_child_weight", 3)),
            subsample=float(cfg.get("subsample", 0.8)),
            colsample_bytree=float(cfg.get("colsample_bytree", 0.8)),
            reg_lambda=float(cfg.get("reg_lambda", 1.0)),
            tree_method="hist", n_jobs=2, random_state=42, verbosity=0,
        )
        model.fit(X_train, np.log1p(y_train) if log_target else y_train)
        future_features = build_features(extended, horizon=horizon, holiday_share=None).loc[future_idx]
        lag_cols = [c for c in future_features.columns if c.startswith(("lag_", "roll", "same_wd", "level"))]
        if future_features[lag_cols].isna().any().any():
            raise ValueError("Forecast feature validation failed; history may be too short")
        prediction = model.predict(future_features)
        if log_target:
            prediction = np.expm1(prediction)
        forecasts.append(np.clip(prediction, 0, None))
    mean_forecast = np.mean(np.vstack(forecasts), axis=0)
    # Empirical residual offsets from the supplied evaluation artifacts; explicitly
    # presented as approximate bands rather than a calibrated guarantee.
    residual_spread = float(max(daily.tail(90).std() * 1.645, 1.0))
    residual_low, residual_high = residual_spread, residual_spread
    rows = []
    threshold = _high_load_threshold(daily)
    for dt, value in zip(future_idx, mean_forecast):
        rows.append({
            "date": dt.date().isoformat(), "weekday": dt.day_name(),
            "forecast": round(float(value), 2),
            "planning_low": round(max(0.0, float(value) - residual_low), 2),
            "planning_high": round(float(value) + residual_high, 2),
            "high_load_threshold": round(threshold, 2),
            "high_load_flag": _is_high_load(float(value), threshold),
        })
    return rows


def _high_load_threshold(daily):
    """Use positive weekday demand so zero-heavy histories do not flag every day."""
    weekday_counts = daily[~daily.index.day_of_week.isin([4, 5])].tail(365)
    positive_counts = weekday_counts[weekday_counts > 0]
    return float(positive_counts.quantile(.75)) if not positive_counts.empty else 0.0


def _is_high_load(forecast, threshold):
    # Match the UI wording: a forecast must be above (not merely equal to) the threshold.
    return bool(threshold > 0 and forecast > threshold)


@app.get("/forecast/health")
def workload_forecast_health():
    try:
        configs = _forecast_configs()
        import xgboost  # noqa: F401 — readiness includes the live inference dependency
    except Exception as exc:
        return {
            "status": "unavailable",
            "model_id": "workload-forecasting-live",
            "mode": "refit-on-uploaded-data",
            "parameters_available": FORECAST_PARAMS_PATH.exists(),
            "reason": type(exc).__name__,
        }
    return {
        "status": "available",
        "model_id": "workload-forecasting-live",
        "mode": "refit-on-uploaded-data",
        "parameters_available": True,
        "configurations_available": len(configs),
    }

@app.post("/forecast/workload")
def workload_forecast(request: WorkloadForecastRequest, _auth: None = Depends(require_model_token)):
    try:
        daily = _live_daily_series(request.records)
        forecast = _live_xgb_forecast(daily, request.horizon)
        recent = [{"date": d.date().isoformat(), "ticket_count": int(v)} for d, v in daily.tail(30).items()]
        return {
            "model_id": "workload-forecasting-live",
            "model_name": "Tuned XGBoost top-configuration ensemble",
            "mode": "refit-on-uploaded-data",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "history_start": daily.index.min().date().isoformat(),
            "history_end": daily.index.max().date().isoformat(),
            "history_days": int(len(daily)),
            "ticket_total": int(daily.sum()),
            "horizon": request.horizon,
            "forecast": forecast,
            "recent_history": recent,
            "notes": [
                "Forecast was fitted using the records submitted with this request.",
                "Holiday regressors are omitted unless a live holiday calendar is supplied.",
                "The upper band is a variability-based planning estimate, not a calibrated 90% guarantee.",
            ],
        }
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Live workload forecast failed: {type(exc).__name__}") from exc

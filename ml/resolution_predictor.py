"""Inference helpers for the resolution-time regression artifact.

The notebook trains a scikit-learn pipeline on the engineered columns defined
here.  Keeping feature construction in a small importable module makes the
saved artifact usable from a later FastAPI route without importing the
notebook's ``__main__`` module.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
import pandas as pd


DEFAULT_ARTIFACT_PATH = (
    Path(__file__).resolve().parent / "artifacts" / "resolution" / "resolution_model.joblib"
)
RAW_INPUT_COLUMNS = ("issue_created", "issue_priority", "issue_type", "issue_proj")
CATEGORICAL_FEATURES = ("issue_priority", "issue_type", "issue_proj")
NUMERIC_FEATURES = (
    "created_year",
    "created_month",
    "created_dayofweek",
    "created_hour",
    "created_dayofmonth",
    "created_is_weekend",
)
ENGINEERED_FEATURE_COLUMNS = CATEGORICAL_FEATURES + NUMERIC_FEATURES


def _parse_timestamp(values: pd.Series) -> pd.Series:
    """Parse mixed timestamp formats as UTC, preserving invalid values as NaT."""

    try:
        return pd.to_datetime(values, errors="coerce", utc=True, format="mixed")
    except TypeError:  # pandas < 2.0 compatibility
        return pd.to_datetime(values, errors="coerce", utc=True)


def _as_frame(records: Any) -> pd.DataFrame:
    if isinstance(records, pd.DataFrame):
        return records.copy()
    if isinstance(records, Mapping):
        return pd.DataFrame([records])
    if isinstance(records, Sequence) and not isinstance(records, (str, bytes)):
        return pd.DataFrame(records)
    raise TypeError("records must be a mapping, a sequence of mappings, or a pandas DataFrame")


def build_resolution_features(
    records: Any,
    *,
    created_column: str = "issue_created",
) -> pd.DataFrame:
    """Build the creation-time feature frame expected by the saved pipeline.

    Required inputs are the ticket creation timestamp, priority, type, and
    project.  The function intentionally does not accept post-resolution
    fields such as final status, resolution timestamp, workflow durations, or
    final assignee information.
    """

    frame = _as_frame(records)
    aliases = (created_column, "issue_created", "created", "created_at", "opened_at")
    selected_created_column = next((name for name in aliases if name in frame.columns), None)
    if selected_created_column is None:
        raise ValueError(
            "Missing creation timestamp. Expected one of: " + ", ".join(dict.fromkeys(aliases))
        )

    missing = [column for column in RAW_INPUT_COLUMNS[1:] if column not in frame.columns]
    if missing:
        raise ValueError("Missing required prediction-time columns: " + ", ".join(missing))

    created = _parse_timestamp(frame[selected_created_column])
    if created.isna().any():
        bad_rows = created.index[created.isna()].tolist()[:5]
        raise ValueError(f"Creation timestamp contains invalid or missing values at rows {bad_rows}")

    features = pd.DataFrame(index=frame.index)
    for column in CATEGORICAL_FEATURES:
        features[column] = frame[column].astype("string")
    features["created_year"] = created.dt.year.astype("float64")
    features["created_month"] = created.dt.month.astype("float64")
    features["created_dayofweek"] = created.dt.day_of_week.astype("float64")
    features["created_hour"] = created.dt.hour.astype("float64")
    features["created_dayofmonth"] = created.dt.day.astype("float64")
    features["created_is_weekend"] = (created.dt.day_of_week >= 5).astype("float64")
    return features.loc[:, list(ENGINEERED_FEATURE_COLUMNS)]


def load_resolution_pipeline(artifact_path: str | Path = DEFAULT_ARTIFACT_PATH) -> Any:
    """Load the persisted scikit-learn resolution-time pipeline."""

    path = Path(artifact_path)
    if not path.exists():
        raise FileNotFoundError(f"Resolution model artifact not found: {path}")
    return joblib.load(path)


def predict_resolution_hours(
    ticket: Mapping[str, Any] | pd.DataFrame,
    *,
    artifact_path: str | Path = DEFAULT_ARTIFACT_PATH,
) -> float | np.ndarray:
    """Return a non-negative point estimate in hours for one or more tickets."""

    features = build_resolution_features(ticket)
    pipeline = load_resolution_pipeline(artifact_path)
    predictions = np.asarray(pipeline.predict(features), dtype="float64")
    if not np.isfinite(predictions).all():
        raise ValueError("The resolution model returned a non-finite prediction")
    predictions = np.maximum(predictions, 0.0)
    if len(predictions) == 1:
        return float(predictions[0])
    return predictions


def predict_resolution_time(
    ticket: Mapping[str, Any] | pd.DataFrame,
    *,
    artifact_path: str | Path = DEFAULT_ARTIFACT_PATH,
) -> dict[str, Any] | list[dict[str, Any]]:
    """Return prediction value, unit, and prediction type for API responses."""

    prediction = predict_resolution_hours(ticket, artifact_path=artifact_path)
    if isinstance(prediction, np.ndarray):
        return [
            {
                "duration": float(value),
                "unit": "hours",
                "prediction_type": "point_estimate",
            }
            for value in prediction
        ]
    return {
        "duration": float(prediction),
        "unit": "hours",
        "prediction_type": "point_estimate",
    }

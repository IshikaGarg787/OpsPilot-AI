"""Integration and smoke tests for the main ML service.

The delay-risk classifier runs in a separate scikit-learn 1.6.1 runtime
(``ml/delay_risk_service.py`` on port 8001) and is intentionally not imported
here. This module covers the endpoints served by ``ml/resolution_api.py``:

- Resolution-time prediction
- Live workload forecasting (refit on submitted daily history)

The route functions are exercised directly so the checks do not require an
HTTP test-client dependency.
"""

import unittest

import pandas as pd
from pydantic import ValidationError

from ml.resolution_api import (
    PredictionRequest,
    WorkloadForecastRequest,
    WorkloadRecord,
    health,
    metadata,
    predict,
    runtime,
    workload_forecast,
    workload_forecast_health,
)


def daily_records(days: int = 125) -> list[dict]:
    dates = pd.date_range("2024-01-01", periods=days, freq="D")
    return [{"date": day.date().isoformat(), "ticket_count": 5} for day in dates]


class MainModelServiceSmokeTest(unittest.TestCase):
    # --- Resolution-time model ---
    def test_health_check_reports_resolution_available(self):
        body = health()
        self.assertEqual(body["status"], "available")
        self.assertEqual(body["service"], "resolution-time")

    def test_resolution_metadata_returns_category_options(self):
        body = metadata()
        self.assertEqual(body["status"], "available")
        self.assertEqual(body["model_id"], "resolution-time")
        self.assertIn("fields", body)
        self.assertGreater(len(body["fields"]["issue_priority"]["options"]), 0)
        self.assertTrue(body.get("model_version"))
        self.assertEqual(body["model_version"], runtime.model_version())

    def test_resolution_predict_valid_payload(self):
        body = predict(
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority="High",
                issue_type="Bug",
                issue_proj="C00d3dzwj28av.ew8x3",
            )
        )
        self.assertEqual(body["model_id"], "resolution-time")
        self.assertEqual(body["unit"], "hours")
        self.assertEqual(body["prediction_type"], "point_estimate")
        self.assertGreaterEqual(body["duration"], 0.0)
        self.assertTrue(body.get("model_version"))

    def test_resolution_predict_accepts_unseen_category_for_ignore_encoder(self):
        body = predict(
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority="not-a-real-priority",
                issue_type="Bug",
                issue_proj="unseen-project",
            )
        )
        self.assertGreaterEqual(body["duration"], 0.0)

    def test_resolution_predict_rejects_missing_field(self):
        with self.assertRaises(ValidationError):
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority="High",
                issue_proj="C00d3dzwj28av.ew8x3",
            )

    # --- Workload forecasting model ---
    def test_workload_health_reports_available(self):
        body = workload_forecast_health()
        self.assertEqual(body["status"], "available")
        self.assertGreater(body["configurations_available"], 0)

    def test_workload_forecast_7_day(self):
        request = WorkloadForecastRequest(records=daily_records(), horizon=7)
        body = workload_forecast(request)
        self.assertEqual(body["horizon"], 7)
        self.assertEqual(len(body["forecast"]), 7)
        self.assertGreater(body["ticket_total"], 0)
        for day in body["forecast"]:
            self.assertIn("date", day)
            self.assertIn("weekday", day)
            self.assertGreaterEqual(day["forecast"], 0.0)
            self.assertLessEqual(day["planning_low"], day["planning_high"])
            self.assertIsInstance(day["high_load_flag"], bool)

    def test_workload_forecast_14_day(self):
        request = WorkloadForecastRequest(records=daily_records(), horizon=14)
        body = workload_forecast(request)
        self.assertEqual(len(body["forecast"]), 14)

    def test_workload_rejects_invalid_horizon(self):
        with self.assertRaises(ValidationError):
            WorkloadForecastRequest(records=daily_records(), horizon=8)

    def test_workload_rejects_short_history(self):
        with self.assertRaises(Exception):
            workload_forecast(WorkloadForecastRequest(records=daily_records(30), horizon=7))

    def test_workload_rejects_fractional_counts(self):
        records = daily_records()
        records[10]["ticket_count"] = 1.5
        parsed = [WorkloadRecord(**record) for record in records]
        with self.assertRaises(Exception):
            workload_forecast(WorkloadForecastRequest(records=parsed, horizon=7))


if __name__ == "__main__":
    unittest.main()

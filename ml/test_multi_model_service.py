"""Comprehensive integration and smoke tests for OpsPilot AI Multi-Model Service.

Tests:
- Service health and multi-model availability
- Model A: Resolution-time prediction (valid inputs, invalid category handling, non-negativity)
- Model B: Delay-risk classification (probability scoring, risk bands, threshold tuning, explanations)
- Model C: Workload forecasting (7-day and 14-day horizons, intervals, invalid horizons)
- Error handling (malformed payloads, missing fields, schema validation)
"""

import unittest
from fastapi.testclient import TestClient

from ml.resolution_api import app


class MultiModelServiceSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    # --- Health & Discovery ---
    def test_health_check_reports_all_models_available(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "available")
        self.assertIn("models", data)
        self.assertEqual(data["models"]["resolution-time"], "available")
        self.assertEqual(data["models"]["delay-risk"], "available")
        self.assertEqual(data["models"]["workload-forecasting"], "available")

    def test_models_listing(self):
        resp = self.client.get("/models")
        self.assertEqual(resp.status_code, 200)
        models = resp.json()["models"]
        model_ids = [m["id"] for m in models]
        self.assertIn("resolution-time", model_ids)
        self.assertIn("delay-risk", model_ids)
        self.assertIn("workload-forecasting", model_ids)

    # --- Model A: Resolution-Time Regression ---
    def test_resolution_metadata_returns_category_options(self):
        resp = self.client.get("/metadata")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "available")
        self.assertEqual(data["model_id"], "resolution-time")
        self.assertIn("fields", data)
        self.assertIn("issue_priority", data["fields"])
        self.assertGreater(len(data["fields"]["issue_priority"]["options"]), 0)

    def test_resolution_predict_valid_payload(self):
        payload = {
            "issue_created": "2024-01-12T09:30:00Z",
            "issue_priority": "High",
            "issue_type": "Bug",
            "issue_proj": "C00d3dzwj28av.ew8x3",
        }
        resp = self.client.post("/predict/resolution-time", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["model_id"], "resolution-time")
        self.assertEqual(data["unit"], "hours")
        self.assertEqual(data["prediction_type"], "point_estimate")
        self.assertGreater(data["duration"], 0.0)

    def test_resolution_predict_rejects_unknown_category(self):
        payload = {
            "issue_created": "2024-01-12T09:30:00Z",
            "issue_priority": "SUPER_URGENT_NOT_A_REAL_PRIORITY",
            "issue_type": "Bug",
            "issue_proj": "C00d3dzwj28av.ew8x3",
        }
        resp = self.client.post("/predict/resolution-time", json=payload)
        self.assertEqual(resp.status_code, 422)

    def test_resolution_predict_rejects_missing_field(self):
        payload = {
            "issue_created": "2024-01-12T09:30:00Z",
            "issue_priority": "High",
            # missing issue_type
            "issue_proj": "C00d3dzwj28av.ew8x3",
        }
        resp = self.client.post("/predict/resolution-time", json=payload)
        self.assertEqual(resp.status_code, 422)

    # --- Model B: Ticket Delay-Risk Classification ---
    def test_delay_risk_metadata_returns_thresholds_and_bands(self):
        resp = self.client.get("/metadata/delay-risk")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["model_id"], "delay-risk")
        self.assertIn("risk_bands", data)
        self.assertIn("operating_thresholds", data)
        self.assertIn("high_recall", data["operating_thresholds"])
        self.assertIn("metrics_held_out_test", data)

    def test_delay_risk_predict_valid_ticket(self):
        payload = {
            "id": "TICK-TEST-1",
            "issue_created": "2023-03-15T10:00:00Z",
            "issue_priority": "High",
            "issue_type": "Bug",
            "issue_proj": "C00d3dzwj28av.ew8x3",
            "issue_reporter": "4hho",
        }
        resp = self.client.post("/predict/delay-risk", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        res = data["data"]
        self.assertEqual(res["ticket_id"], "TICK-TEST-1")
        self.assertGreaterEqual(res["risk_probability"], 0.0)
        self.assertLessEqual(res["risk_probability"], 1.0)
        self.assertIn(res["risk_band"], ["low", "medium", "high"])
        self.assertIsInstance(res["predicted_delayed"], bool)
        self.assertEqual(len(res["top_contributing_factors"]), 5)
        for factor in res["top_contributing_factors"]:
            self.assertIn("feature", factor)
            self.assertIn("impact", factor)
            self.assertIn(factor["direction"], ["increases_risk", "reduces_risk"])

    def test_delay_risk_custom_threshold_tuning(self):
        payload = {
            "id": "TICK-THRESH-TEST",
            "issue_created": "2023-03-15T10:00:00Z",
            "issue_priority": "High",
            "issue_type": "Bug",
            "issue_proj": "C00d3dzwj28av.ew8x3",
            "threshold": 0.95,  # Very high threshold
        }
        resp = self.client.post("/predict/delay-risk", json=payload)
        self.assertEqual(resp.status_code, 200)
        res = resp.json()["data"]
        self.assertEqual(res["threshold_used"], 0.95)
        # At 0.95 threshold, predicted_delayed should be False
        self.assertFalse(res["predicted_delayed"])

    def test_delay_risk_rejects_invalid_timestamp(self):
        payload = {
            "issue_created": "not-a-timestamp",
            "issue_priority": "High",
            "issue_type": "Bug",
            "issue_proj": "C00d3dzwj28av.ew8x3",
        }
        resp = self.client.post("/predict/delay-risk", json=payload)
        self.assertEqual(resp.status_code, 422)

    # --- Model C: Workload Forecasting ---
    def test_workload_metadata_returns_horizons(self):
        resp = self.client.get("/metadata/workload-forecasting")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["model_id"], "workload-forecasting")
        self.assertIn("supported_horizons_days", data)
        self.assertEqual(data["default_horizon_days"], 7)

    def test_workload_forecast_7_day(self):
        resp = self.client.get("/forecast/workload?horizon=7")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        res = data["data"]
        self.assertEqual(res["horizon_days"], 7)
        self.assertEqual(len(res["forecasts"]), 7)
        self.assertGreater(res["weekly_total_tickets"], 0.0)
        for day in res["forecasts"]:
            self.assertIn("date", day)
            self.assertIn("weekday", day)
            self.assertGreaterEqual(day["forecast"], 0.0)
            self.assertLessEqual(day["lower_90"], day["upper_90"])
            self.assertIsInstance(day["high_load_flag"], bool)

    def test_workload_forecast_14_day(self):
        resp = self.client.get("/forecast/workload?horizon=14")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["data"]["forecasts"]), 14)

    def test_workload_forecast_rejects_excessive_horizon(self):
        resp = self.client.get("/forecast/workload?horizon=99")
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()

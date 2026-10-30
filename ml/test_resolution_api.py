import unittest

from .resolution_api import PredictionRequest, runtime


class ResolutionModelSmokeTest(unittest.TestCase):
    def test_real_artifact_loads_and_returns_hours(self):
        self.assertTrue(runtime.available)
        result = runtime.predict(
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority="High",
                issue_type="Bug",
                issue_proj="C00d3dzwj28av.ew8x3",
            )
        )
        self.assertEqual(result["model_id"], "resolution-time")
        self.assertEqual(result["unit"], "hours")
        self.assertGreaterEqual(result["duration"], 0)
        self.assertEqual(result["model_version"], runtime.model_version())

    def test_model_version_is_not_the_artifact_timestamp(self):
        version = runtime.model_version()
        self.assertTrue(version)
        self.assertNotEqual(version, runtime.metadata.get("generated_at_utc"))
        self.assertIn("resolution-time", version)

    def test_model_encoder_handles_unseen_categories(self):
        result = runtime.predict(
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority="not-a-real-priority",
                issue_type="Bug",
                issue_proj="unseen-project",
            )
        )
        self.assertGreaterEqual(result["duration"], 0)

    def test_ticket_values_from_screenshot_are_supported(self):
        result = runtime.predict(
            PredictionRequest(
                issue_created="2026-10-29T21:02:00Z",
                issue_priority="Highest",
                issue_type="Assistance",
                issue_proj="C02gg0x93",
            )
        )
        self.assertGreaterEqual(result["duration"], 0)


if __name__ == "__main__":
    unittest.main()

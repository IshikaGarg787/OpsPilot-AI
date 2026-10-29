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

    def test_unknown_category_is_rejected(self):
        with self.assertRaises(Exception):
            runtime.predict(
                PredictionRequest(
                    issue_created="2024-01-12T09:30:00Z",
                    issue_priority="not-a-real-priority",
                    issue_type="Bug",
                    issue_proj="C00d3dzwj28av.ew8x3",
                )
            )


if __name__ == "__main__":
    unittest.main()

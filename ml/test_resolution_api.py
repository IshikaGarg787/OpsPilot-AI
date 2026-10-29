import unittest
import math

from fastapi import HTTPException
from .resolution_api import PredictionRequest, app, predict, runtime
from .resolution_predictor import DEFAULT_ARTIFACT_PATH, ENGINEERED_FEATURE_COLUMNS, build_resolution_features, load_resolution_pipeline


class ResolutionModelSmokeTest(unittest.TestCase):
    def test_v3_artifact_loads_and_uses_only_prediction_time_features(self):
        self.assertTrue(DEFAULT_ARTIFACT_PATH.name.endswith('v3.joblib'))
        model = load_resolution_pipeline()
        record = {
            'issue_created': '2022-06-01T12:00:00Z', 'issue_priority': 'High',
            'issue_type': 'Bug', 'issue_proj': 'unknown-project',
            'issue_resolution_date': '2099-01-01T00:00:00Z', 'issue_status': 'resolved',
            'issue_assignee': 'post-creation-value', 'id': 'target-proxy',
        }
        features = build_resolution_features(record)
        self.assertEqual(list(features.columns), list(ENGINEERED_FEATURE_COLUMNS))
        self.assertNotIn('issue_resolution_date', features.columns)
        prediction = float(model.predict(features)[0])
        self.assertTrue(math.isfinite(prediction))
        self.assertGreaterEqual(prediction, 0)

    def test_real_artifact_loads_and_returns_hours(self):
        self.assertTrue(runtime.available)
        categories = runtime.categories()
        result = runtime.predict(
            PredictionRequest(
                issue_created="2024-01-12T09:30:00Z",
                issue_priority=categories["issue_priority"][0],
                issue_type=categories["issue_type"][0],
                issue_proj=categories["issue_proj"][0],
            )
        )
        self.assertEqual(result["model_id"], "resolution-time")
        self.assertEqual(result["unit"], "hours")
        self.assertGreaterEqual(result["duration"], 0)

    def test_metadata_reports_v3_evaluation_and_api_contract(self):
        metadata = runtime.metadata_response()
        self.assertEqual(metadata['target_unit'], 'hours')
        self.assertEqual(metadata['model_name'], 'HistGradientBoostingRegressor with log1p target')
        self.assertEqual(metadata['evaluation']['final_test']['n'], 9877)
        self.assertIn('validation_mae_hours', metadata['evaluation']['validation'])
        self.assertAlmostEqual(metadata['evaluation']['test_median_baseline']['mae_hours'], 1371.1631, places=2)
        self.assertIn('/predict/resolution-time', {route.path for route in app.routes})
        self.assertIn('/metadata', {route.path for route in app.routes})
        categories = runtime.categories()
        payload = PredictionRequest(issue_created='2024-01-12T09:30:00Z', issue_priority=categories['issue_priority'][0], issue_type=categories['issue_type'][0], issue_proj=categories['issue_proj'][0])
        result = predict(payload)
        self.assertTrue(math.isfinite(result['duration']))
        malformed = payload.model_dump()
        malformed['issue_created'] = 'not-a-date'
        with self.assertRaises(HTTPException) as context:
            runtime.predict(PredictionRequest(**malformed))
        self.assertEqual(context.exception.status_code, 422)

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

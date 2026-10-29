import unittest
import pandas as pd

from pydantic import ValidationError

from ml.resolution_api import WorkloadForecastRequest, WorkloadRecord, _live_daily_series, workload_forecast_health


class LiveWorkloadDataTests(unittest.TestCase):
    def test_daily_aggregate_fills_missing_days(self):
        dates = pd.date_range("2024-01-01", periods=125, freq="D")
        records = [WorkloadRecord(date=d.date().isoformat(), ticket_count=5) for i, d in enumerate(dates) if i != 3]
        series = _live_daily_series(records)
        self.assertEqual(len(series), 125)
        self.assertEqual(series.iloc[3], 0)

    def test_ticket_level_filters_non_support_types(self):
        dates = pd.date_range("2024-01-01", periods=125, freq="D")
        records = []
        for d in dates:
            records.append(WorkloadRecord(issue_created=d.isoformat(), issue_type="Ticket"))
            records.append(WorkloadRecord(issue_created=d.isoformat(), issue_type="Vacation"))
        series = _live_daily_series(records)
        self.assertEqual(len(series), 125)
        self.assertEqual(int(series.sum()), 125)

    def test_rejects_short_history(self):
        records = [WorkloadRecord(date=d.date().isoformat(), ticket_count=2) for d in pd.date_range("2025-01-01", periods=30)]
        with self.assertRaisesRegex(ValueError, "120 days"):
            _live_daily_series(records)

    def test_rejects_invalid_aggregate_rows_instead_of_dropping_them(self):
        dates = pd.date_range("2024-01-01", periods=125, freq="D")
        records = [WorkloadRecord(date=d.date().isoformat(), ticket_count=5) for d in dates]
        records[10] = WorkloadRecord(date="not-a-date", ticket_count=5)
        with self.assertRaisesRegex(ValueError, "valid date"):
            _live_daily_series(records)

    def test_rejects_fractional_ticket_counts(self):
        dates = pd.date_range("2024-01-01", periods=125, freq="D")
        records = [WorkloadRecord(date=d.date().isoformat(), ticket_count=1.5) for d in dates]
        with self.assertRaisesRegex(ValueError, "whole ticket counts"):
            _live_daily_series(records)

    def test_only_supported_forecast_horizons_are_accepted(self):
        records = [{"date": "2024-01-01", "ticket_count": 1}] * 120
        with self.assertRaises(ValidationError):
            WorkloadForecastRequest(records=records, horizon=8)

    def test_forecast_readiness_checks_model_configuration(self):
        health = workload_forecast_health()
        self.assertEqual(health["status"], "available")
        self.assertGreater(health["configurations_available"], 0)


if __name__ == "__main__":
    unittest.main()

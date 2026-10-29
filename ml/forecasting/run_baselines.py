"""Run all baselines and print a comparison table.

Usage (from the repo root):  python -m ml.forecasting.run_baselines [path/to/issues.csv] [start_date]
"""
import sys
from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from ml.forecasting.prepare_series import load_issues, build_daily_series, quality_report
from ml.forecasting.baselines import BASELINES
from ml.forecasting.evaluate import rolling_origin_eval, score

DATA = sys.argv[1] if len(sys.argv) > 1 else "data/raw/issues.csv"
START = sys.argv[2] if len(sys.argv) > 2 else "2018-01-01"
TEST_DAYS, HORIZON = 84, 7          # last 12 weeks are the test period, forecast 7 days at a time
OUT = Path("ml/artifacts/forecasting"); OUT.mkdir(parents=True, exist_ok=True)

daily = build_daily_series(load_issues(DATA), start=START)
daily.to_csv(OUT / "daily_ticket_counts.csv")
print("== Data quality ==")
for k, v in quality_report(daily).items():
    print(f"  {k}: {v}")
print(f"\nTrain: {daily.index[0].date()} -> {daily.index[-TEST_DAYS-1].date()}"
      f" | Test: {daily.index[-TEST_DAYS].date()} -> {daily.index[-1].date()}")

results, preds = [], {}
for name, fn in BASELINES.items():
    p = rolling_origin_eval(daily, fn, test_days=TEST_DAYS, horizon=HORIZON)
    preds[name] = p
    results.append({"model": name, **score(p)})

table = pd.DataFrame(results).sort_values("MAE").reset_index(drop=True)
table.to_csv(OUT / "baseline_results.csv", index=False)
print("\n== Baseline results (horizon = 7 days, walk-forward) ==")
print(table.to_string(index=False))

# plot: actual vs two baselines over the test period
fig, ax = plt.subplots(figsize=(12, 4.5))
test = daily.iloc[-TEST_DAYS:]
ax.plot(test.index, test.values, color="black", lw=1.5, label="actual")
for name, c in [("moving_avg_7", "tab:orange"), ("seasonal_moving_avg_4w", "tab:blue")]:
    p = preds[name]
    ax.plot(p["date"], p["forecast"], color=c, lw=1.2, label=name)
ax.set_title("Daily ticket volume: actual vs baselines (test period)")
ax.set_ylabel("tickets / day"); ax.legend(); fig.tight_layout()
fig.savefig(OUT / "baseline_forecast_plot.png", dpi=130)
print("\nSaved: ml/artifacts/forecasting/daily_ticket_counts.csv, baseline_results.csv, baseline_forecast_plot.png")

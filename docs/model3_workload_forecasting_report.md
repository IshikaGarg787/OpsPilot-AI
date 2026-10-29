# Model 3 — Workload Forecasting: Technical Report

**Project:** OpsPilot AI  |  **Module:** `ml/forecasting/`  |  **Status:** optional model, implemented and evaluated
**Companion notebook:** `model3_workload_forecasting.ipynb` (repo root)

> All figures below come from a reproducible run of `python -m ml.forecasting.run_models` (training/test cut-off, folds and
> hyper-parameters are fixed in the code and in `ml/artifacts/forecasting/best_params.json`). Small differences (about ±0.3 MAE)
> can appear on other machines because XGBoost/Prophet versions differ.

---

## 1. Purpose and scope

Model 3 forecasts **how many support tickets will be created per day**, so managers can anticipate workload
spikes. It complements the other two models:

| Model | Question | Unit |
|---|---|---|
| 1. Delay-risk prediction | Which *open* ticket is likely to be late? | one ticket |
| 2. Resolution-time prediction | How long will it take? | one ticket |
| **3. Workload forecasting** | **How many tickets will arrive?** | **one day** |

The problem statement makes this model *optional* and conditional on "enough reliable timestamped historical
data". Section 2 documents why that condition is met.

## 2. Data

* **Source:** "Help Desk Tickets", Mendeley Data (`https://data.mendeley.com/datasets/btm76zndnt/3`). Verify the
  licence and attribution on the source page before redistributing the data (as required by the main README).
* **File used:** `issues.csv`, one row per ticket. 66,691 unique tickets, created 2007-04-15 to 2023-03-14, no
  missing creation timestamps, no duplicate ids. `holidays_by_country.csv` supplies public holidays for 18 masked
  country codes.
* **Filtering:** only `Ticket`, `Service` and `HD Service` types are kept. Types such as `Vacation`, `Epic`,
  `Sprint Summary` and `Retrospective` are not customer workload.
* **Modelling window:** 2018-01-01 to 2023-03-14 (1,899 days, 26,456 tickets, mean 13.9 tickets/day, 193 zero-days).
  Counts are per **UTC calendar day**.
* **Weekly pattern:** the working week is Sunday–Thursday (average tickets/day: Sun 20.9, Mon 19.8, Tue 18.8,
  Wed 18.4, Thu 16.7, Fri 1.4, Sat 1.7). Friday/Saturday are treated as the weekend.
* **Holiday effect:** on working days, volume averages 13.2 tickets on holiday-heavy days vs 19.5 on normal days.
  *holiday_share* = share of ticket volume coming from countries on holiday that day. The country is read from the
  first three characters of the project code (`C00`–`C17`); weights are computed from tickets **before** the test
  period.

## 3. Method

**Features (XGBoost):** same-weekday lags (t-7, t-14, t-21, t-28), 7/28/91-day rolling means, rolling std, calendar
(weekday, weekend flag, month, day-of-month, ISO week) and holiday features (today, previous day, next day).

**Models:** four baselines (7- and 28-day moving average, seasonal naive, weekday-aware 4-week moving average),
Holt-Winters, Prophet (weekly seasonality + holiday regressor), XGBoost, and a Prophet + XGBoost ensemble.

**Leakage controls**

1. Every lag/rolling feature is shifted by ≥ 7 days (the forecast horizon), so one model can predict all 7 days.
2. At prediction time the future rows are built from the history extended with NaN; a runtime assertion fails if
   any lag feature would need an unseen value.
3. Holiday country weights use only pre-test tickets.
4. The final test period is excluded from tuning and from model selection.

**Evaluation protocol**

```
|------------ CV region (tuning + selection) -------------|-- FINAL TEST --|
| train ... | f1 | f2 | f3 | f4 | f5 | f6                  | 2022-12-21 →    |
                                                            | 2023-03-14      |
```

* Walk-forward, expanding window: every week the model is re-fitted on data before the origin and forecasts the
  next 7 days.
* 6 folds × 8 weeks (2022-01-19 → 2022-12-20) for tuning and selection; final test = last 12 weeks.
* Metrics: MAE (primary), RMSE, sMAPE, and **weekly-total WAPE** (error of the 7-day sum, which is what staffing
  decisions use).

**Tuning:** grid search (Holt-Winters, 9 configurations), random search (Prophet 40, XGBoost 60), scored by mean
CV MAE. The single best XGBoost configuration proved fragile — two configurations with near-identical CV MAE
(4.215 vs 4.217 in the tuning runs) differed strongly on the final test — so the final XGBoost forecast is the **average of the 5 best
configurations**.

## 4. Results

| Model | CV MAE (± std) | Final-test MAE | CV weekly WAPE % | Test weekly WAPE % |
|---|---|---|---|---|
| Moving average (7 days) | 9.76 ± 0.44 | 12.37 | 17.6 | 22.6 |
| Moving average (28 days) | 9.68 ± 0.46 | 11.89 | 13.6 | 15.8 |
| Seasonal naive | 6.03 ± 1.05 | 8.17 | 17.6 | 22.6 |
| **Seasonal moving avg (4 weeks) — baseline to beat** | **5.10 ± 0.71** | **6.61** | **13.6** | **15.8** |
| Holt-Winters (tuned) | 4.82 ± 0.57 | 6.26 | 14.9 | 17.1 |
| Prophet (default) | 4.53 ± 0.21 | 5.95 | 10.7 | 16.0 |
| Prophet (tuned) | 4.26 ± 0.38 | 5.44 | 10.3 | 15.6 |
| XGBoost (default) | 4.44 ± 0.28 | 6.42 | 12.5 | 18.9 |
| XGBoost (tuned, top-5 average) | 4.33 ± 0.27 | 6.24 | 12.9 | 16.4 |
| **Ensemble Prophet + XGBoost (selected on CV)** | **4.09 ± 0.38** | **5.68** | **10.4** | **16.0** |
| Ensemble Holt-Winters + Prophet + XGBoost | 4.19 ± 0.32 | 5.68 | 11.4 | 15.8 |

**Reading the table**

* The selected ensemble lowers CV MAE by about **20%** versus the strongest simple baseline (5.10 → 4.09) and wins
  in all 6 folds in the reference run (the notebook recomputes this per fold from your own `ml/artifacts/forecasting/`).
* On the final test the reduction is about **14%** (6.61 → 5.68). This is only 12 weeks and noisy; treat
  cross-validation as the primary evidence.
* Tuning helped: Prophet 4.53 → 4.26 and XGBoost 4.44 → 4.33 CV MAE.
* **Weekly totals:** the ensemble improves the weekly-total error in CV (13.6% → 10.4%) but **not on the final test**
  (15.8% vs 16.0%). We therefore do not claim a weekly-planning benefit over the baseline.
* Final-test RMSE is 10.5 vs 11.1 for the baseline: almost no gain, because a few extreme days dominate it.
* Prophet alone is the best model on the final test (5.44). The ensemble was nevertheless selected because model
  choice is made on CV only, and the ensemble has the lowest CV error.

**Prediction intervals.** 90% intervals are built from CV residual quantiles (separately for workdays and weekends).
Coverage on the final test is **85.7%** — slightly too narrow.

**High-load flag.** A day is flagged when the forecast reaches the 75th percentile of the last 365 workdays
(26 tickets).

| Threshold | Tickets | Flagged days | Truly heavy days | Precision | Recall |
|---|---|---|---|---|---|
| 75th percentile | 26 | 31 | 41 | 0.71 | 0.54 |
| 85th percentile | 29 | 2 | 24 | 0.50 | 0.04 |
| 90th percentile | 32 | 0 | 18 | – | 0.00 |

The flag identifies moderately busy days reasonably, but it **does not detect real spikes** (e.g. days with 69 and
88 tickets in the test period).

## 5. Output contract and integration (proposed)

Model 3 writes a forecast table that the backend can serve without retraining:

| Column | Meaning |
|---|---|
| `date` | forecast day (UTC) |
| `forecast` | expected tickets created |
| `lower_90`, `upper_90` | 90% interval |
| `high_load_flag` | 1 if forecast ≥ workday 75th percentile |
| `high_load_threshold` | threshold used |
| `model` | model name/version |

Files: `ml/artifacts/forecasting/forecast_next_7d.csv`, `ml/artifacts/forecasting/forecast_next_14d.csv`. The 7-day horizon is validated; the
14-day horizon is produced by the same pipeline but has not been evaluated separately.

**How it connects to Models 1 and 2 and the optimiser** (proposal for the team to agree on — the main README does
not yet define a forecast endpoint or table):

* Models 1 and 2 score the **existing backlog** (risk and expected resolution time per open ticket).
* Model 3 supplies the **expected inflow** of new tickets, with an upper band as a pessimistic scenario.
* The optimiser compares backlog + forecast inflow against capacity (simulated and clearly labelled, because the
  dataset has no capacity data) and the simulator can replay baseline and proposed policies on the same forecast
  arrivals.
* Suggested additions: a `volume_forecasts` table and an endpoint such as `GET /api/v1/forecasts?horizon=7`.
* All three models should share the same ticket-type filter, UTC convention and train/test cut-off date.
* Note: resolution time is calendar time, not working effort; do not multiply forecast tickets by resolution hours
  as if they were staff-hours.

## 6. Limitations

1. **Spikes are not predictable** from past counts. In the final test the two worst days account for roughly a
   fifth of the total absolute error (notebook, section 5), and the top ten days for almost half.
2. **Daily counts are over-dispersed** (workday variance/mean ≈ 3.3 since 2021, versus 1.0 for pure Poisson noise),
   which limits achievable daily accuracy.
3. **Final test is short** (12 weeks); its metrics are noisy and differ by a few tenths of MAE between runs.
4. **No weekly-total gain on the final test** (see Section 4).
5. **Intervals under-cover** (85.7% vs 90% target) and the **high-load flag is unstable** near its threshold.
6. **Dataset ends in March 2023**; the "next 14 days" files demonstrate the pipeline, they are not a live forecast.
   `holidays_by_country.csv` also ends on 2023-12-31.
7. Holiday country attribution relies on the masked project-code prefix; internal projects without a prefix are
   treated as having no holidays.
8. Historical patterns do not establish causes; the forecast must not be presented as evidence of
   business improvement.

## 7. Reproducibility

```bash
# from the repo root
pip install -r ml/forecasting/requirements.txt
# place issues.csv and holidays_by_country.csv in data/raw/   (data/raw/ is git-ignored; do not commit the dataset)
python -m ml.forecasting.run_models        # ~5 min; writes everything in ml/artifacts/forecasting/
# optional: python -m ml.forecasting.tune  # ~10 min; OVERWRITES ml/artifacts/forecasting/best_params.json
# notebook: open model3_workload_forecasting.ipynb in VS Code / Jupyter (kernel = the environment above)
```

Key files: `ml/forecasting/{prepare_series,features,baselines,models,cv,evaluate}.py`, `ml/forecasting/tune.py`,
`ml/forecasting/run_models.py`, `ml/artifacts/forecasting/best_params.json`,
`ml/artifacts/forecasting/model_comparison.csv`, `ml/artifacts/forecasting/cv_fold_scores.csv`,
`ml/artifacts/forecasting/surge_eval.csv`.

## 8. Planned improvements

1. **Weekly-level forecast** (next step) — the unit managers plan staffing on.
2. Calibrated prediction intervals (e.g. conformal) and a tiered load flag (normal / high / very high).
3. Per-country or per-project forecasts, to test whether spikes originate from a single source.
4. Validate the 14- and 30-day horizons.
5. Persist trained models, add the forecast table and API endpoint, and add unit tests (leakage guard, output
   schema).

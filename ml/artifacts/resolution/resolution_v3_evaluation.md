# Resolution-time regression v3 evaluation

## Diagnosis

The target is UTC elapsed hours, `issue_resolution_date - issue_created`. Mixed timestamp strings parse successfully with pandas `format="mixed"`; the data has 66,691 rows, no missing creation dates, no negative or zero durations, and no duplicate IDs. There are 853 missing resolution timestamps (1.28%), so those rows have no regression target and are excluded without assigning current age as eventual duration. They cannot all be called right-censored: 251 are explicitly marked `closed` or `resolved` despite the missing date, and additional rows have terminal-looking statuses such as `done`. The status breakdown is saved in the evaluation JSON. Both checked `issues.csv` files have the same SHA-256 fingerprint.

The reported temporal shift is real, not a unit conversion or log-scale scoring bug. The chronological 70/15/15 timestamp-observed split has train/validation/test target means of 26,086 / 943 / 540 hours and medians of 5,414 / 213 / 143 hours. The training 75th percentile is 53,495 hours versus 713 in validation and 500 in test. By creation year, median duration drops from 96,190 hours in 2007 to 143 hours in test-era tickets. All 2007–2011 records with timestamps have resolution dates in 2018. This points to a changed historical regime or a bulk closure/migration cohort; the extract alone cannot establish which long records are stale or erroneous. They were retained.

The 488.8 MAE / 127.1 MedAE report reproduces exactly on the original v2 artifact, final test partition (n=9,877), and inverse-transformed hours. The saved partition is 9,875 validation and 9,877 test rows; one other audit calculation used a different 85% index boundary and was off by one validation row. Metrics below use the saved partition. The negative R² is not a scale bug: the model's test RMSE is about 1,181 hours, slightly over the 1,160-hour test standard deviation, so it loses to the test-mean predictor on squared error while its MAE is much better. The model's predicted mean is 185 hours versus the actual mean of 540, reflecting underprediction of the long tail.

## Split and target distributions

| Split | Creation range (UTC) | n timestamped | Mean h | Median h | SD h | P75 h | P90 h | P95 h | P99 h |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Train | 2007-04-15 – 2019-10-13 | 46,086 | 26,086 | 5,414 | 30,173 | 53,495 | 73,059 | 80,186 | 92,927 |
| Validation | 2019-10-13 – 2021-08-08 | 9,875 | 943 | 213 | 2,294 | 713 | 2,211 | 4,346 | 13,195 |
| Test | 2021-08-08 – 2023-03-14 | 9,877 | 540 | 143 | 1,160 | 500 | 1,364 | 2,475 | 6,560 |

All values use the same chronological sample with a recorded resolution timestamp. The full yearly, monthly, priority, type, and project distributions and test breakdowns by priority, type, project (n≥30), duration band, and quarter are in `resolution_v3_evaluation.json`.

## Baseline and model comparison

The selected model is HistGradientBoosting with a log1p target, inverse-transformed to hours, clipped nonnegative, and chosen from validation plus rolling-origin evidence. Test baselines were fitted only on train+validation. The validation priority median is fitted only on train. Percentages are the share of test predictions within the stated absolute error. The existing experiment artifacts had already reported this same chronological holdout for multiple candidates, so it is not a newly blind final test; v3 metrics below are post-selection diagnostics, and selection did not use those test scores.

| Predictor | Validation MAE h | Test MAE h (days) | Test MedAE h (days) | Test RMSE h (days) | Test R² | Within 24h | 72h | 7d | 30d |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Training median | 4,866 | 1,371 (57.13) | 1,447 (60.27) | 1,548 (64.50) | -0.781 | 0.2% | 0.8% | 2.0% | 10.3% |
| Training mean | 25,144 | 21,109 (879.56) | 21,506 (896.10) | 21,141 (880.89) | -331.232 | 0.0% | 0.0% | 0.0% | 0.0% |
| Priority median (train-only on validation; train+val on test) | 1,074 | 507 (21.11) | 184 (7.68) | 1,201 (50.05) | -0.072 | 4.7% | 14.2% | 40.7% | 85.4% |
| Creation-year median (train-only, global fallback) | 4,458 | 1,214 (50.59) | 1,392 (58.00) | 1,535 (63.98) | -0.752 | 1.5% | 4.5% | 10.3% | 25.5% |
| Log1p HistGradientBoosting v3 | 878 | **489 (20.36)** | **127 (5.29)** | **1,181 (49.20)** | **-0.037** | **8.9%** | **29.9%** | **58.6%** | 84.3% |

The v3 model improves test MAE by 18.0 hours (3.6%) over the strong priority-median baseline, with better MedAE and RMSE too; it gives up about 1.1 percentage points in the 30-day tolerance rate. This is a real but modest improvement, not a general resolution-time guarantee. The validation MAE also beats the training-only priority median by 196.6 hours. The mean baseline's huge error is caused by including a decade-long historical regime in its training mean.

The pre-existing focused experiment log in `ml/experiments/resolution_experiments_comparison.csv` records validation MAE 867.1 h for a 100-tree ExtraTrees log1p model and 878.7 h for log1p HGB; the reproduced v3 HGB validation MAE is 877.6 h. That approximately 10-hour (1.2%) single-window edge is small. HGB was selected because it has the completed expanding-window evidence below and substantially lower fit cost. Repeating the 100-tree ExtraTrees fit for multiple windows exceeded the laptop's practical runtime, so ExtraTrees temporal stability remains unverified and the single-window edge is not hidden or treated as decisive.

The log1p inverse transform produces a low predicted mean relative to the actual mean, as expected for a right-skewed target. A validation-only multiplicative retransformation check at factors 0.75, 1.0, 1.25, 1.5, 2.0, and 3.0 found the uncorrected factor 1.0 had the best MAE (877.6 h); factor 1.25 slightly lowered RMSE but worsened MAE. No correction was applied because MAE was the prespecified selection objective. This does not claim unbiased conditional-mean predictions.

The original production artifact scored test MAE 692.2 h, MedAE 463.5 h, RMSE 1,215.5 h, R² -0.098. V2 scored 488.8 h, 127.1 h, 1,183.8 h, and -0.042 respectively. V3 was retrained on train+validation with the documented recipe and scored 488.7 h, 127.0 h, 1,180.9 h, and -0.037. These are original-hour metrics after inversion of log1p.

## Stability, tail, and limitations

Three expanding chronological windows (training from 2015 onward) produced model MAEs of 1,373 h (2017–18), 829 h (2019–20), and 628 h (2021–22), versus training-only priority-median MAEs of 3,432 h, 835 h, and 760 h. HGB beats that baseline in all three windows; its edge is small in 2019–20 and larger in the other two. All window R² values remain negative. Tail performance is weak: test absolute-error P90/P95/P99 are about 1,204 / 2,295 / 5,805 hours; tickets with observed durations over 30 days (n=1,800) have MAE 1,989 hours. R² within narrow duration bands is unstable and should not be read as a separate product score.

The 853 missing-date rows cannot be given an ordinary-regression total-duration label, and their status labels do not reliably distinguish censored from resolved-with-missing-date records. A survival/AFT model was not fitted: xgboost is installed, but the supplied snapshot table is a multi-row status/history table (90,963 rows for 66,691 issue IDs), and the extract does not identify an authoritative per-ticket censor/observation cutoff or event indicator for the missing-date records. Treating current age or last-change time as eventual duration would be wrong; inventing a censor date would make survival metrics untrustworthy. Regression on timestamp-observed tickets can have selection bias if records missing resolution timestamps differ systematically.

The request schema and UI expose priority, type, project, and creation time. No IDs, resolution/status fields, post-creation aggregates, reporter identity, holidays, or historical outcome aggregates enter the feature builder. The v3 artifact handles unseen one-hot categories; the existing API validation still rejects category strings outside its learned list. All four API inputs remain required by the current request contract.

The saved model artifact is versioned and records dataset fingerprint, exact package versions, dates, split sizes, feature contract, parameters, seed, and evaluation metrics. No dependency was added. Simple row-wise confidence intervals were omitted because repeated project/time cohorts make independent-row resampling misleading.

## Reproduction

From the repository root in PowerShell:

```powershell
.\venv\Scripts\python.exe ml/experiments/evaluate_resolution_v3.py
.\venv\Scripts\python.exe -m unittest ml.test_resolution_api -v
```

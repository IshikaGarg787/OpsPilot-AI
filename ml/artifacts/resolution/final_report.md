# Pragya Resolution-Time Prediction Report

Generated from `C:\Users\Acer\Desktop\Projects\OpsPilot-AI\Help Desk Tickets` on 2026-10-26 (UTC).

## Target and exclusions
- Target: elapsed hours from `issue_created` to `issue_resolution_date`.
- Included resolved tickets: **65,838**.
- Unresolved/censored tickets excluded: **853**; these were not assigned zero duration.
- Negative durations excluded: **0**.
- Tickets with recorded reopen count > 0 among included rows: **2,099**; final elapsed duration is still the label.
- The target is highly right-skewed; long durations were retained rather than silently trimmed.

## Features and leakage controls
- Raw engineered feature count: **9**; transformed feature count after imputation/one-hot encoding: **292**.
- Predictors are priority, issue type, project, and creation-time calendar features.
- IDs, final resolution/status fields, final timestamps, final assignee/contributor/comment totals, workflow aggregates, and future history changes were excluded.

## Model comparison
Validation selection used MAE only; the test period was not used for tuning or selection.

```text
                              model  validation_mae_hours  validation_rmse_hours  validation_r2  fit_seconds  tuned
Tuned HistGradientBoostingRegressor           1089.978137            2371.292772      -0.068932   120.469091   True
      HistGradientBoostingRegressor           1174.821720            2513.735569      -0.201210    13.865247  False
              RandomForestRegressor           3521.351370            4201.784117      -2.356194    10.168404  False
                     MedianBaseline           4866.244459            5024.808799      -3.799751     0.565228  False
                              Ridge          17948.960381           19895.051118     -74.243625     0.726709  False
```

Selected model: **Tuned HistGradientBoostingRegressor**.
Tuned tree candidate: **HistGradientBoostingRegressor**; measured validation MAE change from untuned to tuned: **84.844 hours** (positive means improvement).

## Final untouched-test metrics
- MAE: **692.212 hours**
- RMSE: **1,215.478 hours**
- R2: **-0.098175**
- Median-baseline test MAE: **1,371.163 hours**
- Selected-model improvement over the train+validation median baseline: **678.951 hours** (positive means lower MAE).
- Final fit runtime on train+validation: **13.638 seconds**; tuning runtime: **120.469 seconds**.

## Best parameters
```json
{
  "model__min_samples_leaf": 10,
  "model__max_leaf_nodes": 31,
  "model__max_iter": 150,
  "model__learning_rate": 0.1,
  "model__l2_regularization": 1.0
}
```

## Limitations and assumptions
- This is a resolved-ticket regression model and does not model censoring or time-to-event uncertainty for unresolved tickets.
- The source data contains very long elapsed durations and masked identifiers; performance may not transfer to a different help-desk system or current operating policy.
- Project, priority, and issue type are assumed to be available at creation because they are documented ticket attributes; production ingestion should verify this contract.
- Point predictions are not SLA deadlines, guarantees, or causal estimates. Permutation importance is associational model diagnostics only.
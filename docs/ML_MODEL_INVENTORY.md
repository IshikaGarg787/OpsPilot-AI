# OpsPilot AI — ML Model Inventory

This inventory distinguishes notebook experiments, exported artifacts, and capabilities actually served by the application. Artifact presence alone does not establish that an artifact is deployable or currently used.

## Model 1 — Ticket delay risk (integrated isolated runtime)

- **Purpose / target:** At ticket creation, estimate probability of resolution taking longer than the chosen threshold. Notebook output auto-selects 720 hours (30 days). Open tickets already past threshold are described as delayed.
- **Inputs:** Raw ticket fields compatible with the source `issues.csv`; creation timestamp plus mapped priority/category/project/country/reporter-style fields and history-derived features. Exact mapping is data-dependent and stored in the exported bundle.
- **Method:** The exported metadata identifies a `random_forest` classifier with sigmoid calibration, max depth 14, minimum leaf size 40, and 1,095-day recency half-life. The selected probability threshold is 0.1842 for a high-recall goal; low/medium/high display bands are separate probability bands at 0.4/0.7.
- **Evaluation:** Chronological 70/15/15 split with label embargo per notebook; validation calibration/threshold selection; held-out test. Artifact model card reports test PR-AUC 0.493 (prevalence 0.199), ROC-AUC 0.742, precision 0.279, recall 0.789, F1 0.412, and Brier 0.1352. Top-10% lift is 3.02x in notebook output. These are saved historical experiment results, not live service results.
- **Artifacts:** `artifacts-delay_risk_model/delay_risk_model.joblib`, `delay_risk_metadata.json`, `history_reference.csv.gz`, `MODEL_CARD.md`.
- **Inference contract:** `ml/delay_risk_service.py` loads the bundle and history reference, builds time-safe features, and scores new intake as `new-intake`. Complaint text is not a model input. Express validates its output and ticket creation stores it when service health permits.
- **Artifact compatibility:** The bundle requires scikit-learn 1.6.1 and runs in the separately pinned `ml/requirements-delay-risk.txt` environment, isolated from the main runtime.
- **Status:** Available through the isolated service. Local inference was exercised; Mongo-backed browser workflow and production deployment remain unverified.

## Model 2 — Resolution-time regression (integrated, weak baseline result)

- **Purpose / target:** Estimate elapsed resolution time in hours from ticket creation-time data.
- **Raw inputs:** `issue_created`, `issue_priority`, `issue_type`, `issue_proj`. Engineered inputs are priority/type/project plus creation year, month, weekday, hour, day-of-month, and weekend flag.
- **Method:** Notebook selects tuned `HistGradientBoostingRegressor`; persisted scikit-learn pipeline at `ml/artifacts/resolution/resolution_model.joblib`.
- **Evaluation:** Chronological train/validation/test; notebook reports untouched test MAE 692.2123 hours, RMSE 1215.4779 hours, R² -0.0982 across 9,877 rows. Test median baseline MAE is 1,371.16 hours, so the model's MAE is lower by 678.95 hours; negative R² still indicates worse squared-error performance than a mean predictor. Reported model is point prediction only.
- **Serving:** FastAPI `POST /predict/resolution-time`, `GET /metadata`, `GET /health`; Express proxies validated prediction and persists the response. Category options are derived from the fitted encoder.
- **Limitations:** Negative R² means worse than a mean-reference under the notebook's reported test; large errors and skew warrant clear expectation setting. This is not SLA-breach classification, not a calibrated interval, and not causal guidance.
- **Status:** Connected; the notebook's weak test performance remains a material limitation.

## Model 3 — Workload forecasting (live request-time refit)

- **Purpose / target:** Forecast daily support-ticket counts from historical tickets or daily aggregates.
- **Accepted data:** Ticket-level `issue_created`, optionally `issue_type`; or `date,ticket_count`. The API fills gaps with zero and requires at least 120 days between first and last date. Max request size is 250,000 records.
- **Features / method:** `ml/forecasting/features.py` builds calendar, lag, and rolling features. `/forecast/workload` reads `best_params.json`, refits each selected XGBoost configuration on uploaded history, recursively creates horizon features, and averages predictions. Saved `workload_xgboost.joblib` is not loaded by this live route.
- **Outputs:** daily forecast, heuristic lower/upper ranges, high-load flag and threshold, recent history, and provenance notes. The app and integrated API support 7/14-day choices.
- **Offline evaluation:** Notebook/report describes walk-forward validation and a final test. That reported result is separate from a forecast made on arbitrary uploaded data. The live planning range is based on recent-series standard deviation, not calibrated residual quantiles, and is explicitly not labeled as a 90% interval. High-load threshold uses the last 365 non-Friday/Saturday dates, matching the dataset's Sunday–Thursday work week documented in the report.
- **Readiness:** `/forecast/health` parses the configuration and imports XGBoost. It does not perform a model fit, so successful health is dependency/config readiness, not proof a forecast will succeed for every input history.
- **Status:** Live CSV forecasting exists. Admin ticket triage accepts daily aggregates and saves an outlook on the linked ticket; true capacity inputs are not present.

## Cross-model product contract

- Ticket creation stores available delay-risk and resolution outputs; Admin triage saves a combined risk/resolution/workload decision record and updates the ticket.
- The standalone workload page remains request-scoped; the ticket-linked integrated flow persists its forecast summary on the ticket.
- Do not combine resolution-duration hours with forecast ticket counts as staffing effort; no labor-time or capacity contract exists.
- The ZIP lacks raw data, so model retraining and independent reproduction of notebook metrics are blocked without obtaining the cited dataset and confirming its terms.

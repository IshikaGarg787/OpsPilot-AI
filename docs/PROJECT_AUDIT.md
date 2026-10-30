# Pragya — Repository Audit

**Audit scope:** supplied `OpsPilot-AI-live-forecast-integrated.zip`, extracted to this project folder. Source inspection completed 2026-10-29. The ZIP has no `.git` directory, so Git history and prior changes could not be verified.

## Verified architecture

- **Client:** React 19 + TypeScript + Vite, React Router, Recharts, Framer Motion, Lucide. The protected workspace has dashboard, prediction, resolution prediction, workload forecasting, model center, history, analytics, and settings routes. There is also a landing page and authentication flow.
- **API:** Express 5 + TypeScript + Zod + Mongoose. The API provides authentication/session handling, user-scoped predictions/history, dashboard aggregates, model registry, and readiness/liveness endpoints.
- **ML service:** FastAPI. The resolution endpoint loads a saved scikit-learn pipeline; live workload forecasts are refit from submitted history using XGBoost and shared feature-building code.
- **Database:** MongoDB via Mongoose for user, session, and prediction records. There is no PostgreSQL implementation in the inspected source; one README prerequisites paragraph incorrectly mentions PostgreSQL.
- **Service flow:** Browser calls Express for authenticated prediction/persistence. Forecasting currently calls FastAPI directly from the browser with a configurable `VITE_ML_BASE_URL`. Express checks the workload health endpoint for its registry.
- **Artifacts/data:** Resolution model plus metadata/metrics under `ml/artifacts/resolution`; forecasting configuration and historical evaluation outputs under `ml/artifacts/forecasting`; delay-risk artifact bundle under `artifacts-delay_risk_model`. No raw source dataset is included.

## Implemented capabilities

1. Account signup/login/logout and cookie-backed session restoration; profile/preferences; user-scoped prediction history.
2. Resolution-time single-record prediction: four creation-time inputs are validated, sent to FastAPI, and persisted after a valid result.
3. Live workload forecast page accepts CSV and offers 7- or 14-day forecasts. The API supports ticket rows or daily aggregates and refits using submitted history.
4. Dashboard, analytics, history, and model registry reflect persisted prediction activity and the two connected services.
5. Operational risk has a notebook and exported model artifacts, but the app represents this as `coming_soon`; no API/UI inference flow is connected.

## Notebook and model findings

- `version3-help-desk-tickets.ipynb` models ticket delay risk at creation time, with a validation-selected 720-hour target in its recorded output. It describes chronological splits, an embargo, calibration, explanations, and export of a bundle plus history reference. Its model card reports held-out PR-AUC 0.493, ROC-AUC 0.742, recall 0.789, and test prevalence 19.9%; notebook output reports top-10% risk lift 3.02x. **These are saved experiment outputs, not current service results.** The artifact warns it was created with scikit-learn 1.6.1 and fails to load under the repository's pinned 1.9.1 (`_RemainderColsList` missing). The archive has no raw data to retrain/re-export it, and no inference module or route consumes it.
- `resolution_time_prediction.ipynb` predicts elapsed resolution duration in hours from creation time and ticket attributes. It uses a chronological split and reports an untouched test MAE of 692.21 h, RMSE 1215.48 h, and R² -0.0982 (9,877 rows). Its MAE is 678.95 h lower than the included test median baseline (1,371.16 h), while the negative R² indicates worse squared-error performance than a mean predictor. This artifact is served by the FastAPI resolution route. It is an experimental point estimate, not an SLA guarantee.
- `model3_workload_forecasting.ipynb` forecasts daily ticket counts. Its report describes walk-forward validation and a final test, and it reports a tuned/ensemble evaluation. The live endpoint uses the current forecasting feature builder and tuned XGBoost configurations and refits against uploaded history; it does not integrate a distinct external notebook.
- **Updated external forecasting notebook:** not present as a separate file in the archive. The repository's `model3_workload_forecasting.ipynb` is present. Do not claim it is the reportedly newer external version.

## What is working vs. not yet verified

**Verified by direct source inspection:** routes/components and service contracts exist; registry health checks call service health endpoints; resolution feature construction excludes post-resolution inputs; workload accepts the two documented data shapes; environment examples exist.

**Verified after the initial audit:** root/server/client dependencies install from lockfiles; server TypeScript build, client production build, server validation tests, Python model/forecast tests, and synthetic seven-/14-day forecast checks pass. A direct connection handshake to the user-provided Atlas cluster succeeded. The first browser-based visual inspection could not complete because the Windows UI approval timed out. MongoDB-backed user/prediction writes and accessibility review remain unverified.

## Highest technical and judging risks

1. **Root dependency/setup integrity:** root `package.json` declares dependency `all: ^0.0.0`, which appears unrelated and may break or pollute installation. Root scripts are Windows-specific, and README setup text conflicts about database type and Python environment naming. Resolve startup commands before judging demos.
2. **Model claims vs. evidence:** operational-risk model is not connected; delay-risk bundle is incompatible with the pinned inference runtime; resolution model beats the included median baseline on MAE but has negative R²; forecast ranges on uploaded data are heuristic estimates, not the calibrated intervals summarized in the offline notebook report. UI/demo narration must accurately label these limitations.
3. **Forecast readiness/contract:** `/forecast/health` now checks for valid XGBoost configuration and a loadable XGBoost dependency. The API accepts only 7/14-day horizons, validates aggregate counts and ticket timestamps, and returns `planning_low`/`planning_high` to avoid implying calibrated intervals. It does not execute a full model fit as part of health; browser-to-ML CORS remains hard-coded to localhost.
4. **Security/configuration:** local Vite defaults point at localhost, acceptable for local development but not deployment. ML CORS allows only two local origins (good local restriction, but needs configurable origins for deployment). MongoDB is required by API startup, so the app is not fully usable without it.
5. **UI differentiation:** the application has polished page/component structure and theme support, but analytics currently describes prediction history rather than operational outcomes. Demo strength depends on making a coherent end-to-end scenario and showing source/limitations clearly, not adding unsupported AI claims.
6. **Reproducibility/data:** archive contains artifacts and evaluation CSVs, but not raw source data. Retraining/evaluation cannot be reproduced from this ZIP alone. No source dataset/license confirmation was performed.

## Prioritized remaining work

1. Start Docker Desktop or provide MongoDB, then verify signup → resolution prediction → saved history end to end.
2. Review the rendered experience and accessibility in a browser; the code now reports forecast readiness, but visual QA did not run.
3. Re-export the delay-risk artifact from its source notebook in the supported scikit-learn runtime, or keep it unavailable until the raw training data and compatible environment are available.
4. Evaluate forecast reliability on representative uploaded operational data before making any accuracy claims.

See [`ML_MODEL_INVENTORY.md`](ML_MODEL_INVENTORY.md) for per-model contracts and [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md) for staged acceptance criteria.

# OpsPilot AI — Verification Report

**Run date:** 2026-10-29  
**Project:** extracted from `OpsPilot-AI-live-forecast-integrated.zip`

## Environment

- Node.js 24.22.0, npm 12.2.0
- Python 3.12.14 with pinned ML dependencies from `ml/requirements.txt`
- Docker CLI is installed; Docker daemon is not running
- No MongoDB service is installed or listening on localhost; the user-provided Atlas connection completed a direct Mongoose connection handshake successfully

## Passed checks

| Check | Result |
|---|---|
| Clean root/server/client npm installs from lockfiles | Passed |
| Express TypeScript build | Passed |
| Client production build | Passed; route-level code splitting removes the previous >500 KB chunk warning. Largest initial entry is ~283 KB (~90 KB gzip); charts are separate chunks. |
| Server test suite | 2 passed, 0 failed |
| Python resolution + workload tests | 9 passed, 0 failed |
| Resolution artifact inference smoke test | Passed; artifact loaded and returned a non-negative point estimate in hours. |
| Workload forecast smoke test, 7-day horizon | Passed; 7 rows returned from 365 days of synthetic test history. |
| Workload forecast smoke test, 14-day horizon | Passed; 14 rows returned with the documented planning-range fields. |
| Workload health readiness function | Passed with valid configuration and XGBoost import. |
| `docker compose config` | Passed; local database port is bound to 127.0.0.1 and persistent data uses a named volume. |
| npm audit (root, client, server) | 0 vulnerabilities reported in each package tree. |
| Argon2 hashing smoke test | Passed despite npm blocking package install scripts by default. |
| MongoDB connection handshake | Passed against the user-provided Atlas URI using the `opspilot` database name; no records were created or changed. |

## Not verified / blockers

- **MongoDB-backed end-to-end flow:** the Atlas connection works, but signup → prediction → persisted history could not be completed. No test records were written. The local Compose configuration is valid but the Docker daemon is not running.
- **Direct HTTP integration:** Uvicorn reported successful startup, but requests to its local loopback port were refused in this command environment. Function-level model and route-contract checks passed; browser-to-service HTTP behavior is not confirmed here.
- **Visual browser review and accessibility audit:** the desktop browser inspection did not complete because its UI approval timed out. Production compilation passed, but visual layout and keyboard/screen-reader behavior still need direct review.
- **Delay-risk model:** the saved artifact records scikit-learn 1.6.1 and fails to load under the pinned 1.9.1 runtime (`_RemainderColsList` missing). No raw training dataset is included to retrain/re-export it.
- **Forecast accuracy on uploaded real-world data:** the synthetic smoke test validates execution and shape only. Offline notebook metrics do not establish accuracy for new uploads; the API's planning range is not calibrated.

No deployment or live database success is claimed.

## Integrated roles and model pipeline update — 2026-10-29

The app now includes customer, IT Team, and Admin ticket workflows; separate role/ownership checks; ticket attachments and audit history; and the linked Admin risk → resolution → workload flow. The delay-risk artifact loads and returns a valid score in the isolated pinned runtime. Admin triage is explicitly role-gated, validates that a linked ticket's inputs still match, saves the combined prediction record, and refreshes that ticket's workload outlook.

| Check | Result |
|---|---|
| Server TypeScript build | Passed after role and linked-triage changes. |
| Client production build | Passed after capacity scenario UI; 2,698 modules transformed. Initial JavaScript entry ~287 KB (~92 KB gzip); chart package is split into its own chunk. |
| Server test suite | 2 passed, 0 failed. |
| Main ML tests on Python 3.12 environment | 9 passed, 0 failed. |
| Delay-risk health and inference on isolated runtime | Passed; health reports `available`, and direct model call returned a valid probability/category. |

Capacity scenario support was added: Admins compare explicit baseline/proposed daily capacity against a ticket's saved daily forecast. It persists the scenario and writes an audit event on the source ticket. Calculation is daily demand coverage; no staffing or savings assumptions are inferred.

### Remaining verification

- No browser-driven signup → ticket → Admin assignment → linked triage → customer update journey was run, and no visual/accessibility audit is claimed.
- No MongoDB write or browser request was used to verify ticket visibility scopes end to end. Configure a designated test database before that walkthrough.
- Workload inference for linked triage still depends on a refreshed CSV spanning at least 120 calendar days. The project bundle does not include raw data suitable for a full demo import.
- The primary `.venv` folder found in the workspace contained Python 3.11-incompatible compiled dependencies; the suite passed in `.venv312`. Follow the documented clean Python 3.12 setup when reproducing locally.
- Complaint-text modeling is not implemented. The current workload model forecasts ticket inflow only; capacity scenario comparisons use explicitly entered Admin ticket-per-day capacities and should not be presented as inferred staffing advice or causal savings.

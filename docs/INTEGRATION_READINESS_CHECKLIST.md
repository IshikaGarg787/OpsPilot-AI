# Integration readiness checklist

Status checked 2026-10-29 on `recovery/resolve-bad-merge`. This checklist records verified integration gaps; it does not approve product policy or claim end-to-end readiness.

## Database and API integration

- [ ] Provision a disposable MongoDB test instance and configure a test-only `MONGODB_URI`. Current model tests validate Mongoose documents in memory; they do not verify writes, indexes, sessions, or route behavior. No local `mongod`, Docker CLI, or `mongodb-memory-server` dependency was found during this check.
- [ ] Add isolated HTTP/database integration coverage for signup, login, cookie-backed session restoration (`/api/v1/auth/me`), logout, and sensitive-field filtering.
- [ ] Verify ticket creation persistence, customer ownership on list/detail, unauthorized `401` and forbidden `403`, assignment access, response visibility, validation, and status updates through the actual API.
- [ ] Verify prediction history and dashboard response envelopes against `client/src/types.ts`, including failure records and empty data.
- [ ] Exercise ticket creation with ML services unavailable and confirm persistence still succeeds. The route catches prediction failures, but this has not been tested through an isolated database-backed request.

## ML services

- [ ] Install/use the documented isolated Python environments before model-serving verification: root resolution/workload runtime and `.venv-delayrisk` for delay risk. Do not load delay-risk artifacts in the resolution runtime.
- [ ] Align the existing runtime with `ml/requirements.txt`: it currently has XGBoost 3.2.0 while the manifest pins 3.4.1. The live workload endpoint refits from uploaded history; a bounded synthetic request did not finish within the prior smoke-test window.
- [ ] Replace or split `ml/test_multi_model_service.py`: it expects the former combined API (`/models` and delay-risk routes on the resolution app). Current routes are resolution/workload on port 8000 and delay risk on port 8001.
- [ ] Run bounded request/response and timeout checks against all three services after their documented environments and compatible artifacts are available. Resolution and workload focused unit tests pass; no complete cross-service endpoint smoke has passed.
- [ ] Configure ML CORS for the actual deployed frontend origin before deployment. `ml/resolution_api.py` currently allows only the two localhost Vite origins; the frontend also calls its workload endpoint directly.

## Authorization and ticket policy

- [ ] Approve whether persisted `user` is the Customer role. The current compatibility serializer maps `user` to `customer` without migrating stored users.
- [ ] Approve a trusted IT Team onboarding/membership process. The User schema currently permits only persisted `user` and `admin`; ticket code contains IT branches, but a supported IT account cannot currently be provisioned through public signup.
- [ ] Approve IT ticket access/assignment rules and customer-versus-internal response visibility before expanding the role model. Current code intends IT access to owned/assigned tickets and filters internal responses for customers; database-backed authorization is unverified.
- [ ] Define legal ticket status transitions. The schema and request validator accept known status values, but the route does not enforce a transition graph.
- [ ] Keep Admin provisioning a separate operator action. Before any real provisioning, verify owner identity out of band and use the documented `npm run admin:provision` process with its required configuration from `docs/database-architecture.md`. Do not run it as part of this checklist.
- [ ] Confirm whether any Admin operations are owner-only. `/api/v1/admin/me` and owner-restricted ticket operations currently use authenticated role plus the fixed owner check; verify endpoint coverage in future API tests.

## SLA integration

- [ ] Approve versioned response/resolution targets, priority values, time basis, and effective-date policy. No business-approved target values are configured.
- [ ] Add immutable ticket policy ID/version (and an agreed target snapshot if required) when a ticket is created; do not recalculate historical commitments using a newer policy.
- [ ] Define and persist qualifying `firstResponseAt`, actual resolution events/timestamps, reopen history, and explicit response/resolution pause intervals.
- [ ] Agree whether reopening resumes or restarts the resolution clock and which states, if any, pause clocks. The standalone service currently resumes the original clock and supports only explicitly supplied pauses.
- [ ] Add an API response with separate response/resolution status, ISO-8601 deadlines, remaining/elapsed hours, policy ID/version, and evaluation time; add dashboard counts with agreed denominators. The SLA service is not called by ticket routes and no SLA UI is connected.

## Deployment and verification gate

- [ ] Set deployment-specific `VITE_API_BASE_URL`, backend `CLIENT_ORIGIN`, and ML CORS origins; localhost defaults are for local development.
- [ ] Run browser smoke checks for auth/session expiry, ticket flows, role guards, prediction panels, dashboard empty/error states, and frontend API failures after isolated API tests pass.
- [ ] Record database-backed API tests, compatible model inference checks, and deployment-origin CORS checks separately. A build or schema unit test alone is not end-to-end verification.

## Current verification boundary

Server unit tests and build, client production build, and focused resolution/workload Python tests have passed in the local working state. No production/shared database was accessed. No Admin provisioning, migration, live database/API session test, deployed ML inference, or browser test was performed. See `docs/PROJECT_AUDIT.md`, `docs/database-architecture.md`, and `docs/sla-calculation.md` for the related architecture and policy details.

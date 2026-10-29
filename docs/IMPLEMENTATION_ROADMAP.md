# OpsPilot AI — Phased Completion Roadmap

## Working approach
Complete one phase at a time. At each phase boundary, report the result, changed files, verification evidence, and any blocker; then move to the next phase. Keep the current implementation and artifacts unless inspection shows a specific reason to change them. Avoid scope expansion and run only the checks relevant to the phase.

## Phase 1 — Establish the actual baseline
**Work:** Extract the supplied ZIP into the workspace without overwriting existing user files. Inspect structure, manifests, docs, notebooks, artifacts, routes, configuration, and tests. Record verified facts separately from assumptions. Check whether the separately developed forecasting notebook is present.

**Deliverables:** Project audit, ML inventory, and a refined roadmap in the project docs.

**Done when:** Frontend/backend/ML/data flow, model targets and contracts, available artifacts, setup requirements, and known gaps are documented from the files themselves. No unsupported metrics or capabilities are claimed.

## Phase 2 — Make local startup reproducible
**Work:** Resolve dependency and configuration requirements; document exact PowerShell startup steps; verify service URLs, timeouts, CORS, database requirements, and startup errors. Keep secrets out of source and frontend bundles.

**Done when:** Required services can be started with documented commands, or each external prerequisite and remaining blocker is explicit; configuration examples match actual code.

## Phase 3 — Validate the existing ML contracts
**Work:** For each model, verify preprocessing, target, artifact compatibility, leakage risks, input/output schema, evaluation method, and inference behavior. Fix only evidenced defects. Use time-aware splits and baselines for forecasting.

**Done when:** Each model has a defensible documented contract and relevant checks/evaluation evidence. Missing datasets or the external notebook are recorded as dependencies, not guessed around.

## Phase 4 — Harden workload forecasting
**Work:** Check CSV/data validation, aggregation, missing dates, history limits, forecast horizons, output ranges, high-load logic, API readiness, and frontend errors/chart semantics.

**Done when:** Valid inputs produce the documented schema, invalid inputs fail clearly, and forecast readiness reflects actual artifacts and service health. Reliability claims are limited to the data and evaluation actually available.

## Phase 5 — Complete product workflows
**Work:** Verify navigation, dashboard and Model Center status, prediction flows, authentication boundaries, loading/error/empty states, accessibility, and responsive behavior. Remove misleading mock or placeholder output where found.

**Done when:** Shipped UI paths work against configured services or are clearly identified as unavailable; users can understand the source and limits of model results.

## Phase 6 — Integrated verification and handoff
**Work:** Run relevant Python/server tests, frontend production build, and service integration checks where dependencies/data permit. Fix regressions. Finalize setup, API, model evaluation, test report, limitations, and deployment notes.

**Done when:** Each completion claim has captured evidence; remaining unmet criteria have an explicit reason and next action. Deployment is claimed only if actually deployed and checked.

## Progress

- **Phase 1 — complete:** extracted and inspected the supplied archive; added `PROJECT_AUDIT.md` and `ML_MODEL_INVENTORY.md`; confirmed the external forecast notebook is absent and documented the actual model contracts and limitations.
- **Phase 2 — in progress:** removed the unrelated root `all` dependency, made the combined dev command use the active Python environment, pinned ML dependencies, added PowerShell setup guidance, and added an optional localhost-only MongoDB Compose service. Root/server/client installs and builds work. The user-provided Atlas connection handshake succeeds; the full write flow remains unverified, and the local Docker daemon is unavailable.
- **Phase 3 — complete with a documented blocker:** inventoried all three model contracts and tested resolution artifact inference. The delay-risk artifact is incompatible with the pinned runtime and cannot be re-exported without the missing raw data; it remains unavailable in the app.
- **Phase 4 — complete for input/runtime contract:** restricts forecast horizons to 7/14, validates timestamps and whole non-negative counts, checks XGBoost/config readiness, uses honest planning-range names, and adds focused tests plus 7/14-day smoke checks.
- **Phase 5 — source changes complete; visual QA pending:** route-level lazy loading reduces the initial bundle; model-center copy distinguishes metrics; forecast UI displays service readiness and retries. Browser approval timed out, so visual, keyboard, and screen-reader QA remain outstanding.
- **Phase 6 — in progress:** server tests, Python tests, builds, npm audits, and Compose configuration checks are recorded in `TEST_REPORT.md`. MongoDB end-to-end and direct HTTP/browser verification remain blocked by the local environment.

## Product requirements added from the user

The target workflow is role-based and ticket-centered:

- **Customer:** create an account and tickets with subject, complaint, category, priority, and attachments; see only their tickets, ticket status, public admin responses, and any enabled AI estimates.
- **IT Team:** report internal hardware, software, network, access, and infrastructure issues; see their own and assigned tickets; update assigned work and add resolution notes according to permission.
- **Admin:** see all authorized tickets; assign/reassign, manage priority/status, review risk and resolution estimates, inspect workload and capacity, approve/reject/modify recommendations, compare baseline and proposed plans, and manage users, teams, reports, and audit history.

The interface should present one operational flow: complaint intake → delay-risk triage → resolution-time estimate → workload outlook → human-reviewed action. The complaint narrative remains context unless a text model trained on appropriate complaint data is supplied; the current saved model artifacts do not score raw complaint text.

## Next delivery phases

### Phase 7 — Connect the three model signals — implementation complete; external DB flow unverified
The delay-risk bundle now runs in an isolated scikit-learn 1.6.1 service. Ticket creation stores available risk and resolution outputs. Admin triage runs risk → resolution → workload, writes a decision packet, and refreshes the linked ticket's signals and workload outlook. Complaint text remains context. Local model inference was exercised; the live MongoDB flow still needs end-to-end verification.

### Phase 8 — Role-based ticket workflow — implementation complete; browser QA pending
Signup supports customer/IT Team. Admin bootstrap uses the fixed-owner provisioning CLI; public signup cannot create an Admin. Ticket APIs enforce owner and assignment scopes; attachments, replies, internal notes, resolution notes, status/priority changes, assignments, recommendation decisions, and audit entries are implemented. Server build and route tests pass. Browser role journeys remain unverified.

### Phase 9 — Admin decision operations — implementation complete; human inputs required
Recommendation approval/rejection/modification, ticket-linked workload refresh, and persisted baseline/proposed capacity scenarios are implemented. Admins enter tickets-per-day capacity; the scenario compares daily coverage and uncovered forecast tickets and records a rationale. It does not infer staffing, labor hours, or causal business improvements.

### Phase 10 — Demo-quality verification — remaining work
Run role-permission and ticket lifecycle tests, all service inference checks, responsive UI/accessibility review, and a complete user journey against an explicitly designated test database. Current verification is build and focused service testing; no visual or full MongoDB journey is claimed.

## Immediate next task
For a fully verified demo, run signup → ticket → saved decision history against an explicitly designated test database, then inspect the app visually and run browser accessibility checks. Confirm CSV history quality and load the workload forecast before a live demo.

## Initial evidence and limits
The source audit confirmed a React/TypeScript client, TypeScript/Express API, FastAPI ML service, MongoDB persistence, three notebooks, and exported model artifacts. The archive has no Git history and no raw dataset. It contains the original workload notebook but no distinct newer external forecasting notebook. See `PROJECT_AUDIT.md` and `ML_MODEL_INVENTORY.md` for verified details.

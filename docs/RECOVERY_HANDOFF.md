# OpsPilot AI Recovery Handoff

Checkpoint updated: 2026-10-29 (local time, Asia/Calcutta)

## Repository checkpoint

- Working branch: `recovery/resolve-bad-merge`.
- Latest local and verified `origin/recovery/resolve-bad-merge`: `d758d84295aca92f2d9f58dfdc7d7089c54746b2`.
- Latest verified `origin/main`: `2c2fab0bd441294a8f5f150ac472ba7ce660fb4f`.
- Local `main` remains at `08d593f276034f5025829d40ec3646e522377e4c`; it was not checked out or changed in this phase.
- The untracked `README.conflict-backup.md` remains untouched and uncommitted.
- Pre-existing modifications remain in README/docs, delay-risk artifacts, root package manifests, ML requirements, and the workload notebook. They were not staged or discarded.

## Diagnosis: role flow

### Verified contract

- `server/src/models/User.ts` persists only `user` and `admin`. Public signup creates `user` through an explicit allow-list and does not accept role or username fields.
- The API compatibility view exposes persisted `user` as canonical `customer`; persisted data is not rewritten.
- The frontend type declares `customer`, `it_team`, and `admin`.
- `it_team` is not a permitted persisted User role and has no approved onboarding/provisioning route. Some ticket logic and frontend presentation contain IT branches, but an IT account cannot be created by the supported flow. This remains blocked pending a product-approved role/onboarding policy; no role enum or database records were changed.
- Admin access uses an authenticated session, persisted `admin` role, and the fixed owner identity check for `deepti10648`. `/api/v1/admin/me` is guarded by all three checks. Provisioning was not run and no Admin account was verified active.

### Root causes and fixes in this phase

| Defect | Evidence and consequence | Fix and regression coverage |
|---|---|---|
| Unknown stored roles were normalized as `customer`; the role guard also compared raw role strings. | `normalizedRole()` returned Customer for every non-Admin value, and `requireRole()` accepted raw role strings. Corrupt/unsupported records could enter ordinary user flows instead of failing closed. | `normalizedRole()` now maps only `user` → `customer` and `admin` → `admin`; unsupported values throw. Login, session auth, mixed ticket authorization, and role checks reject unsupported roles. `requireRole` accepts canonical role types only. Authorization tests cover mappings and unknown/`it_team` rejection. |
| Customer navigation used the fallback IT/member menu and the dashboard linked customers to protected ticket triage. | `AppShell` selected Admin navigation or one shared non-Admin menu; dashboard always linked to `/app/triage`, which is Admin-only. | Added separate Customer and IT navigation sets, role-aware dashboard actions, and account-scoped metric wording. Added a guest route that waits for session restoration before showing login/signup. |
| Active UI state was retained after an API 401. | The API client threw `ApiError`, but `AuthContext` retained its in-memory user until refresh. | The API client now dispatches a session-expired event on 401 (including attachment requests); `AuthContext` clears the user. 403 remains an authorization error and does not sign the user out. Client build passed; active-session expiry needs database-backed/browser verification. |

## Backend authorization audit

- Signup/login/session restoration use the existing Argon2id and HTTP-only session-cookie flow. `/auth/me` and `/users/me` serialize the current database-backed user through the canonical role mapping. Password hashes are excluded from public serialization.
- Ticket create/list/detail routes derive ownership from the authenticated user. Customer list/detail access is owner-scoped; IT branches are assignment-scoped but cannot currently be reached through supported IT provisioning. The owner Admin can access organization tickets.
- Customer response serialization excludes internal responses. IT response writes are assignment-scoped; Admin operations are owner-only.
- Prediction list/detail/delete and dashboard aggregates filter by authenticated `userId`. Thus Admin dashboard counts are personal prediction counts, not organization-wide analytics. The UI now says this clearly; an organization-wide Admin analytics contract is not implemented.
- User directory, assignment, priority, recommendation decisions, triage, and capacity planning are owner-Admin protected. No general role mutation endpoint exists.
- Ticket status values are validated, but a transition graph is not enforced. Do not invent lifecycle transitions without product approval.
- No database-backed API integration test was run. All live DB actions were avoided.

## Frontend/API and service verification

- Auth context requests `/api/v1/auth/me` on startup. The browser verified unauthenticated `/app` redirects to `/login`; signup has no role selector.
- API calls use the configured `/api/v1` base and cookies. Customer prediction/dashboard records are user-scoped by backend queries. Full authenticated role navigation and ticket flows were not browser-tested because there is no isolated database or test account.
- Local API was launched with an explicitly empty `MONGODB_URI`; the existing `server/.env` was not read or exposed. No Atlas connection was made.
- Local service status at checkpoint: frontend `http://localhost:5173` HTTP 200; API liveness HTTP 200; API readiness HTTP 503 because MongoDB and delay-risk were unavailable; resolution health HTTP 200; workload health HTTP 200; delay-risk service unavailable.
- A bounded resolution API inference request returned a finite duration in hours. No ticket or prediction record was written.
- Docker is not installed/available. `venv` exists; `.venv-delayrisk` does not. The root `npm run dev` references `.venv` and `.venv-delayrisk`, so services were started directly rather than through that combined command.
- SLA calculation remains a pure service with no Ticket persistence/API/UI integration. Policy targets, response/resolution timestamps, pauses, and reopen semantics still need product decisions.

## Checks completed

| Command/check | Result |
|---|---|
| `npm test --prefix server` | PASS, 40/40 tests, exit 0 after role fail-closed change. |
| `npm run build --prefix server` | PASS, exit 0. An earlier intermediate build failed on nullable role typing; implementation was corrected and the successful build was rerun. |
| `npm run build --prefix client` | PASS, exit 0 after navigation, guest-route, and 401-state changes. |
| `venv/Scripts/python.exe -m unittest ml.test_resolution_api ml.test_workload_forecast` | PASS, 11 tests in 0.347s, exit 0. |
| `venv/Scripts/python.exe -m pytest -q ml/test_resolution_api.py ml/test_workload_forecast.py` | BLOCKED/FAIL, `pytest` is not installed in the existing environment; no packages were installed. |
| Browser unauthenticated `/app` route | PASS, redirected to `/login`. Signup form had no role selector. |
| Local HTTP checks | Frontend, API liveness, resolution, and workload health responded. API readiness returned 503; delay-risk port was unavailable. |
| `git diff --check` / staged diff checks | PASS for the committed code units. |

## Commits from this recovery phase

- `cf64120` — `fix(auth): reject unsupported account roles`; four server files; pushed and verified at recovery ref before the next unit.
- `dd43e56` — `fix(client): align navigation with account roles`; three client files; pushed and verified.
- `c7afb62` — `fix(client): clear expired sessions on unauthorized responses`; two client files; pushed and verified.
- `d758d84` — `docs: record role recovery handoff`; one documentation file; pushed and verified against the live remote ref.

Earlier recovery commits (`e90f7f5`, `d0bfd90`, `d34a67e`, `5dbc87d`, `30995b0`, `2c2fab0`) remain in history. No commits from this phase were pushed to `main`.

## Remaining decisions and blockers

1. Approve whether stored `user` is the Customer role (the current compatibility behavior is implemented without migration).
2. Approve the IT Team onboarding/provisioning policy, persisted role value, team-membership/assignment access model, and handling of any legacy IT records. Do not add `it_team` to the schema or promote users before approval.
3. Approve ticket status transitions, actual resolution timestamp semantics, and reopening behavior.
4. Approve SLA policy versions/targets, response-start and first-response definitions, pause events, calendar/business-hour policy, and reopen treatment before persistence/API integration.
5. Define whether Admin analytics should be organization-wide and which fields/aggregates it may expose.
6. Provide an isolated disposable MongoDB/test fixture and account fixtures for signup/login/session, ticket ownership, internal-note filtering, prediction/dashboard scope, and optional-ML-failure integration tests. Never substitute Atlas/shared production data.
7. Supply the compatible delay-risk environment from `ml/requirements-delay-risk.txt`; do not load its scikit-learn 1.6.1 artifact in the resolution venv.
8. Confirm deployment CORS origins and frontend/API/ML service URLs before staging or deployment.
9. Review the remaining uncommitted recovery docs, manifests, delay-risk artifacts, requirements, and notebook independently; do not bundle them with the role fixes.

## Next steps

1. Continue read-only review of remaining API contracts and existing dirty diffs; preserve all of them.
2. Add focused client tests only if the repository adopts a test runner or an existing supported test approach is found; do not add a dependency without approval.
3. Obtain policy decisions for IT onboarding, Admin analytics scope, status lifecycle, and SLA semantics.
4. Use a disposable local MongoDB/test setup when available, then add HTTP/database integration tests and test authenticated role navigation.
5. Re-run complete server/client suites and bounded ML smoke tests after any approved changes.
6. Commit/push only reviewed, independently verified units to `recovery/resolve-bad-merge`; verify the remote hash after each push. Do not push to `main` in this recovery phase.

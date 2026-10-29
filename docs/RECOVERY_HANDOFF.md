# IT workforce implementation handoff

## Implemented in the replacement bundle

- Extended the current User and Ticket models; no duplicate task collection was added.
- Added an Admin workforce API and responsive Admin page for member workload, task assignment/reassignment, invitations, and activation controls.
- Added IT-only My Tasks page, completion confirmation, optional notes, and role-based landing/navigation.
- New IT access is invitation-only. Setup links expire after 72 hours, store only a token hash, and are not emailed because this app has no mail integration.
- Availability comes from persisted active tickets and member onboarding/active state. Default capacity is one.
- An atomic member reservation plus a unique partial MongoDB key protect assignment and deactivation races; assignment conflicts return 409. Completion uses existing `resolved` status and releases capacity.
- Added a local-only repeatable seven-member demo seed and tagged-record cleanup. See `IT_WORKFORCE_GUIDE.md`.

## Changed files

Server: `src/models/User.ts`, `src/models/Ticket.ts`, `src/models/WorkspaceAudit.ts`, `src/services/workforceService.ts`, `src/routes/workforceRoutes.ts`, `src/routes/authRoutes.ts`, `src/routes/ticketRoutes.ts`, `src/routes/userRoutes.ts`, `src/middleware/auth.ts`, `src/app.ts`, `src/server.ts`, `src/validators/schemas.ts`, `scripts/seed-it-demo.ts`, `scripts/cleanup-it-demo.ts`, `test/workforce.test.ts`, `test/workforce-concurrency.integration.test.ts`, `test/authorization.test.ts`, `test/admin-provisioning.test.ts`, `package.json`.

Client: `src/App.tsx`, `src/components/AppShell.tsx`, `src/contexts/AuthContext.tsx`, `src/pages/AuthPages.tsx`, `src/pages/TicketPages.tsx`, `src/pages/UserManagementPage.tsx`, `src/pages/WorkforcePage.tsx`, `src/pages/MyTasksPage.tsx`, `src/services/api.ts`, `src/styles.css`.

Root: `package.json`. Docs: `IT_WORKFORCE_GUIDE.md`, this handoff.

## Validation actually run in the isolated copy

- Server TypeScript production build: passed.
- Client TypeScript and Vite production build: passed (2,700 modules transformed).
- Server test suite: 37 passed, 0 failed, 1 skipped. The skipped test is the database concurrency/integration test because no dedicated local `opspilot_ai_workforce_test` URI was configured.
- No local or shared database was seeded or modified.

## Not yet verified / risks

- The concurrency and persistence integration test must be run against a dedicated local `opspilot_ai_workforce_test` database as described in `IT_WORKFORCE_GUIDE.md`.
- The full UI/API flow has not been exercised against a running local MongoDB instance.
- No database migration or seed was run. On API startup the new Ticket index is initialized before listening; existing active assignments are read for capacity and will not be backfilled automatically. The standalone database has no multi-document transaction; a process stop between member-slot reservation and ticket write can leave a stale reservation that blocks capacity until repaired.
- No `docs/RECOVERY_HANDOFF.md` or integration readiness checklist was present in the inspected supplied project snapshot before this implementation.
- The source project's Git branch and commit could not be confirmed from this isolated deliverable copy; no commit or push was made.

## Exact next steps after placing files

1. Back up the target files, then extract the bundle into the repository root, preserving its `server/`, `client/`, and `docs/` paths.
2. Install dependencies if needed, then run `npm run build` and `npm test`.
3. Start the repository's local MongoDB, set the `MONGODB_URI` shown in `IT_WORKFORCE_GUIDE.md`, and run `npm run seed:it-demo`.
4. Start `npm run dev`, sign in as the configured Admin, open **IT Workforce**, invite an IT member, and copy the activation link.
5. Accept the invitation in a private browser session, assign a task, submit completion, and confirm the Admin workload updates.
6. Run the dedicated concurrency integration test before treating capacity handling as database-verified.

# OpsPilot AI — database and authorization

## Implemented collections

| Collection | Purpose |
|---|---|
| `users` | Customer, IT Team, and Admin identities. Password hashes are excluded from ordinary reads and public serialization. Legacy `user` records map to Customer. |
| `sessions` | Expiring HTTP-only sessions; only HMAC token hashes are stored. |
| `tickets` | Complaint context, category, priority, ownership, assignment, workflow status, available model signals, recommendation decisions, responses, and audit events. |
| `ticketattachments` | Scoped file metadata and content for ticket attachments. |
| `predictions` | User-scoped resolution and integrated AI decision history, including optional ticket reference and model outputs. |
| `capacityplans` | Admin baseline/proposed ticket-per-day scenarios tied to a saved ticket workload forecast. |

MongoDB is configured only through `MONGODB_URI` in the ignored `server/.env`. The repository's `.env.example` uses a local placeholder. Do not commit production credentials. Connection logs and health responses redact driver details. This checkout has no database credential configured yet, so no live connection or data mutation is claimed.

## Roles and access

- **Customer:** creates and reads only owned tickets and public replies.
- **IT Team:** creates internal tickets and reads owned or assigned tickets; only assigned IT teammates can add work updates or change status.
- **Admin:** reads the authorized workspace queue; assigns/reassigns tickets, changes priorities/statuses, reviews or edits recommendations, manages users/roles, reads audit history, and creates capacity scenarios.

Every ticket route authenticates server-side and applies owner, assignee, and role checks before returning records or applying changes. Internal notes are filtered from customer responses. Admin operations are role-gated; the `/api/v1/admin/me` endpoint additionally verifies the single provisioned owner identity.

Public signup can create Customer or IT Team accounts only. The single Admin owner is provisioned through `npm --prefix server run admin:provision`, with temporary owner verification and confirmation fields in `server/.env`. See the setup section below and `server/src/services/adminProvisioning.ts`; do not assign Admin through public signup.

## Ticket and model data

Ticket description is retained as complaint context. The trained delay-risk and resolution models consume structured creation-time fields, not free-text complaint. Risk and resolution signals are stored on ticket intake and their model runs appear in prediction history. Admin integrated triage runs delay risk → resolution estimate → workload forecast, saves one decision packet, and updates the linked ticket. Workload history uses actual daily customer-ticket counts from OpsPilot when at least 120 days are available; otherwise, Admins can import daily totals or ticket creation timestamps from company records.

Capacity scenario inputs are explicitly supplied by an Admin. The API compares each forecast day's expected tickets to the stated baseline and proposed ticket-per-day capacities, stores uncovered volume and coverage change, and adds a ticket audit event. It does not infer staffing, labor hours, or causal savings.

## Local database and Admin setup

For local MongoDB, start Docker Desktop, then from the project root run `npm run db:up`. For Atlas, replace the blank `MONGODB_URI` in `server/.env` with a rotated URI and verify the database user's network/IP access in Atlas.

To provision the owner account, temporarily set the following in `server/.env` after verifying the owner email:

```text
ADMIN_PROVISION_ACTION=provision
ADMIN_USERNAME=deepti10648
ADMIN_OWNER_EMAIL=deepti10648@gmail.com
ADMIN_OWNER_EMAIL_VERIFIED=true
ADMIN_OWNER_NAME=Owner name
ADMIN_INITIAL_PASSWORD=a-new-strong-password-at-least-16-characters
ADMIN_PROVISION_CONFIRM=PROVISION deepti10648
ADMIN_ALLOW_EXISTING_USER_PROMOTION=false
```

Then run:

```powershell
npm --prefix server run admin:provision
```

After it reports success, remove the temporary initial password and confirmation values from `server/.env`, restart the app if it was running, and log in with the provisioned email and password. Existing Customer/IT accounts can only be promoted after explicit review and setting `ADMIN_ALLOW_EXISTING_USER_PROMOTION=true` for the one-time command. Provisioning refuses ambiguous identity matches and another existing Admin.

## Verification status

Server build and 35 focused server tests pass. Client production build passes. No Atlas/localhost connection was attempted because this folder's `server/.env` has an empty URI; no ticket documents were read or written. Full model inference is pending a compatible Python runtime and its dependency installation. Follow `docs/LOCAL_SETUP.md` for service startup and health checks.

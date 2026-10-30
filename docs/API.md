# OpsPilot API reference

Base URL: `http://localhost:5000/api/v1`

Responses use the following envelope:

```json
{ "success": true, "data": {}, "message": "Optional human-readable message" }
```

Errors include `success: false`, a safe `message`, and a stable `code`. Validation errors may include a `details` array. Authenticated requests use the `ops_session` HTTP-only cookie.

## Health

```powershell
Invoke-RestMethod http://localhost:5000/api/v1/health
Invoke-RestMethod http://localhost:5000/api/v1/health/ready
```

`/health` checks API liveness. `/health/ready` checks MongoDB connectivity and the FastAPI model service and returns HTTP 503 when either dependency is unavailable.

## Support assistant (Customer and IT Team)

`POST /support-chat` is authenticated and limited to Customer and IT Team roles. It accepts the last 1–12 user/assistant messages (`content` up to 2,000 characters each) and returns an answer with mode `static_data`, `local_model`, or `retrieval_only`. The server ranks role-appropriate workflow guidance and at most three relevant tickets from the signed-in user's own records (for IT Team: created or assigned tickets), omitting internal responses. Ticket data is redacted for common credentials, email addresses, and payment-card-like numbers. Common help questions and ticket status lookups receive deterministic replies from retrieved data. For other questions, reachable Ollama receives retrieved context at `OLLAMA_BASE_URL`; if it is unavailable, the API returns a static retrieval answer. No API key or external AI service is used. Chat transcripts are held in browser memory and are not persisted by OpsPilot. The assistant cannot change tickets, priority, assignments, or SLAs.

This is retrieval-augmented generation, not model fine-tuning: the service retrieves built-in support guidance and authorized ticket context, then supplies those snippets to a pretrained local model. The current retriever uses lexical term overlap; it does not require a vector database or API key.

```json
{
  "messages": [
    { "role": "user", "content": "What does in progress mean?" }
  ]
}
```

Response: `{ "success": true, "data": { "answer": "..." } }`.

## Auth

### Signup

`POST /auth/signup`

```json
{
  "name": "Alex Morgan",
  "email": "alex@example.com",
  "password": "a-long-password",
  "termsAccepted": true
}
```

### Login

`POST /auth/login`

```json
{
  "email": "alex@example.com",
  "password": "a-long-password",
  "remember": false
}
```

The response sets the session cookie. `GET /auth/me` returns the public user when the cookie is valid. `POST /auth/logout` invalidates the current session and clears the cookie.

## Model metadata

`GET /models/resolution-time/metadata` returns the actual categories exposed by the saved pipeline, derived fields, and evaluation artifact. The frontend uses the `fields.*.options` arrays to build its form.

## Resolution prediction

`POST /predictions/resolution-time`

```json
{
  "issue_created": "2024-01-12T09:30:00Z",
  "issue_priority": "High",
  "issue_type": "Bug",
  "issue_proj": "C00d3dzwj28av.ew8x3"
}
```

The API authenticates the user, validates the payload, calls FastAPI, validates `duration`, `unit`, and `prediction_type`, then saves the record. A successful response includes:

```json
{
  "success": true,
  "data": {
    "prediction": {
      "id": "mongo-id",
      "modelId": "resolution-time",
      "predictionType": "point_estimate",
      "status": "success",
      "output": { "duration": 882.58, "unit": "hours" }
    },
    "duration": 882.58,
    "unit": "hours",
    "predictionType": "point_estimate"
  },
  "message": "Prediction created."
}
```

The duration in this example documents the response shape and is not a value rendered by the app as sample data.

## History

`GET /predictions?page=1&pageSize=20&modelId=resolution-time` returns records newest first with pagination. Customers and IT members see their own runs; the workspace Admin sees all workspace runs. Existing ticket intake scores are backfilled idempotently from saved ticket signals. `GET /predictions/:id` checks the same scope; deleting a prediction remains limited to its owner. Dashboard aggregates use the same role-aware scope.

## Role-based tickets

All ticket routes require a signed-in session. `POST /tickets` accepts `subject`, `description`, `category`, `priority`, and `project`; it scores creation-time fields with delay-risk and resolution services when healthy, saves available signals with the ticket, and records each model run in prediction history. Complaint text is retained for support staff and is not passed to the trained models. Customers can read only their own tickets; IT Team members can read their own and assigned tickets; Admins can read the workspace queue.

The ticket API also provides scoped `GET /tickets`, `GET /tickets/:ticketId`, public/internal responses, status updates, admin assignment and priority changes, recommendation decisions, and ticket attachments. Admin-only user/role management is available under `/users`. Server middleware checks role and ownership/assignment before returning records or applying changes. Public signup cannot assign Admin; the single Admin owner is provisioned using the protected CLI documented in `database-architecture.md`.

## Integrated ticket decision flow

`POST /predictions/triage` is Admin-only. It accepts complaint context, ticket creation fields, `horizon` (7 or 14), and `workload_records` as daily `{date,ticket_count}` aggregates spanning at least 120 calendar days. Include `ticketId` to bind a run to an existing ticket; the API checks the submitted fields and complaint against the ticket, executes delay risk → resolution time → workload, saves a complete prediction record, and updates the ticket's risk, duration, pending recommendation, and workload outlook. A successful result includes `prediction`, `risk`, `resolution`, and `workload`.

Workload forecasts incoming volume, not staffing capacity. The ticket UI exposes risk and resolution at submission; an Admin uses the linked AI Decision Flow to refresh the complete workload outlook with current history.

## Capacity planning

`GET /capacity-plans` and `POST /capacity-plans` are Admin-only. A new scenario references a ticket with a completed workload outlook, horizon, baseline and proposed tickets-per-day capacity, and a human rationale. The API compares each forecast day against each entered capacity, saves expected demand, covered and uncovered volume, and coverage change, and adds an audit event to the source ticket. This is transparent arithmetic over Admin inputs; it does not infer staffing levels, labor hours, or causal operational improvements.

## Workload forecast (authenticated Express proxy)

The standalone workload page uses these authenticated Express routes. Express validates the request, forwards it to the FastAPI model service at `http://localhost:8000`, validates the forecast response, and returns the result to the browser.

### Readiness

`GET /predictions/workload/health` proxies `GET /forecast/health` and reports whether the XGBoost dependency imports and at least one valid saved configuration can be read. It does not run a forecast fit; an individual request can still fail on invalid or insufficient history.

### Generate a forecast

`GET /predictions/workload/history` is Admin-only. It returns daily customer-ticket counts from OpsPilot, fills dates without tickets with zero, and reports whether at least 120 complete days are available. This avoids requiring a CSV once the workspace has enough history.

`POST /predictions/workload` accepts either ticket-level records or daily aggregates. At least 120 calendar days between the first and last valid date are required. Counts must be finite whole numbers at or above zero. Timestamps are normalized to UTC dates, and gaps are filled with zero. Successful forecasts are saved as `workload-forecasting` entries in prediction history. The optional `source` field is `workspace_ticket_history` or `uploaded_csv`.

Example request (records abbreviated; a real request must cover at least 120 calendar days):

```json
{
  "horizon": 7,
  "records": [
    { "date": "2024-01-01", "ticket_count": 12 },
    { "date": "2024-01-02", "ticket_count": 9 }
  ]
}
```

The API also accepts ticket-level rows such as `{"issue_created":"2024-01-01T09:30:00Z","issue_type":"Ticket"}`. Only `horizon: 7` and `horizon: 14` are supported. If `issue_type` is supplied, only `Ticket`, `Service`, and `HD Service` records are retained. The Triage and standalone pages both apply that filter in the browser before reducing ticket rows to daily counts.

The workload page can download daily OpsPilot customer-ticket totals or a dated blank template (`date,ticket_count`) for importing real history from an existing help desk. The template needs actual counts entered before upload; blank counts are rejected. The response includes `history_start`, `history_end`, `history_days`, `ticket_total`, `forecast`, `recent_history`, and notes. Each forecast row includes `date`, `weekday`, `forecast`, `planning_low`, `planning_high`, `high_load_threshold`, and `high_load_flag`. `planning_low` and `planning_high` are variability-based planning estimates, not calibrated confidence limits. Forecasts are refit from the submitted data and saved to the caller's prediction history.

Invalid schemas, timestamps, counts, or insufficient history return HTTP 422. Missing configuration or an inference failure returns HTTP 503. The FastAPI service remains reachable only through Express for the product UI; its CORS allowlist no longer needs to include a deployed browser origin.

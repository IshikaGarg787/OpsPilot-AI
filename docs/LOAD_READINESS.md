# Load readiness and festival traffic

## Do we need PostgreSQL?

No database migration is required just to handle a traffic spike. This app already uses MongoDB and Mongoose, with indexes on its main ticket and status query paths. A database switch should follow measured evidence (for example, query latency, write contention, or relational reporting requirements), because PostgreSQL would not increase API or model-service capacity by itself.

## Safeguards in the API

- `MAX_IN_FLIGHT_REQUESTS` bounds work admitted by each Node API process. Excess requests get HTTP `503`, `Retry-After: 1`, and a short retry message. Health endpoints and CORS preflight requests bypass this cap.
- `MONGODB_MAX_POOL_SIZE` sets the maximum Mongoose connection pool per API process. `MONGODB_WAIT_QUEUE_TIMEOUT_MS` bounds how long a request waits for a pool connection before failing.
- `API_RATE_LIMIT_WINDOW_MS` and `API_RATE_LIMIT_MAX` tune the existing API rate limiter. Authentication and support-chat routes retain their stricter route-specific limits.
- `RUN_SLA_SCHEDULER` controls the periodic SLA evaluator. If the API is manually scaled to multiple instances, leave this `true` on exactly one instance and set it to `false` on the others to avoid duplicate scheduled work.
- Production Express trusts the single Render load-balancer hop so IP-based limits and secure-cookie handling can use forwarded client/protocol details. If the production proxy topology changes, review this hop count; Express must trust only proxies that sanitize forwarded headers.

These are protection controls, not a promise of a particular requests-per-second capacity. Start with defaults, observe CPU, memory, MongoDB connections, response latency, and 503 counts under a representative load test, then tune the limits for the selected instance size. The global API limiter uses the default in-memory store, so its counters are per process. Before running multiple API replicas, use a shared rate-limit store or another centralized gateway limit; otherwise each replica has its own quota.

## Before a known traffic spike

The checked-in `render.yaml` is explicitly a Free demo: API and both Python model services use Free instances. Render Free services cannot be horizontally scaled and may sleep when idle. For a festival or other planned event:

1. Move the API and CPU-heavy model services to suitable paid instances before the event; keep them in the same region and check their memory/CPU during representative traffic.
2. Manually increase instance counts ahead of the event, or configure Render autoscaling where the workspace/plan supports it. Do not rely on a just-in-time scale-up for a predictable burst.
3. Set the API environment variables above based on the chosen instance size. Set `MONGODB_MAX_POOL_SIZE` with the whole fleet in mind: approximate potential application connections as `API instances × pool size`, plus monitoring connections and other services. Confirm Atlas connection limits before increasing it.
4. If using multiple API instances, configure a shared rate-limit store and designate one SLA-scheduler instance (`RUN_SLA_SCHEDULER=true`). Keep it disabled on the other replicas.
5. Load test realistic reads, ticket writes, chat, and model predictions together. The model services can become the bottleneck before MongoDB; monitor their CPU and request latency separately.

PostgreSQL, Redis, or additional instances have their own operational/cost tradeoffs. Add them only when monitoring shows the relevant bottleneck: PostgreSQL for data/query needs, a shared store for cross-instance coordination, or more compute for API/model saturation.

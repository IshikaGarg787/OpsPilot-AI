# Ticket SLA and operational decision flow

## SLA policy

`server/src/services/slaService.ts` calculates response and resolution clocks independently in calendar hours. The ticket API applies the versioned prototype policy from `server/src/services/slaPolicy.ts` on ticket reads, so the status and remaining time refresh with the current time. Results include the policy ID/version, deadline, elapsed/remaining hours, pause state, and status.

The prototype targets below make the demo operational; they are **not contractually approved service commitments**. Replace them with organization-approved values before relying on attainment reporting.

| Priority | First response | Resolution | At-risk window |
|---|---:|---:|---:|
| Critical / Highest | 1 h | 24 h | 4 h |
| High | 4 h | 72 h | 12 h |
| Medium | 8 h | 168 h | 24 h |
| Low | 24 h | 720 h | 48 h |
| Lowest | 48 h | 1,440 h | 72 h |

Priority names are normalized and common urgency aliases map to these levels. An unrecognized priority has no SLA result; the service does not silently choose a target. This prototype uses calendar hours, does not pause clocks while waiting on customers, and resumes the original resolution clock after reopening. The first response is the first staff/admin response. Resolution completion and reopening timestamps are written by status transitions. Legacy resolved tickets without a stored completion time show resolution as not applicable rather than being treated as currently open.

## Delay-risk prediction and explanations

The isolated delay-risk service uses the pinned artifact runtime described in `docs/LOCAL_SETUP.md`. Its probability estimates whether resolution exceeds the model's historical 720-hour target. That target differs from the prototype SLA policy. The ticket UI shows both values separately and recommendation logic considers either a model review flag or an active SLA at-risk/breached status.

Explanations show historical rates for matching priority, issue type, and project cohorts. Only outcomes known before the ticket's creation are included. Each displayed rate includes its sample size and evidence cutoff. These are descriptive historical associations; complaint text is stored for staff context but is not used by the trained model.

## Recommendation and impact comparison

The triage pipeline recommends priority review when the delay model crosses its review threshold or a linked ticket's SLA is at risk/breached. It suggests raising low/medium priority one level for review. It also suggests the IT teammate with the fewest active assigned tickets. Assignment ignores skills, schedule, and fairness and always requires an administrator's confirmation.

Capacity scenarios compare the uploaded forecast with explicit baseline and proposed tickets-per-day capacity. They report covered and uncovered demand, overloaded forecast days, peak queued backlog, backlog at the horizon, and estimated backlog-clearance days. Clearance assumes arrivals stop after the forecast horizon and available daily capacity remains constant; it is a planning scenario, not a causal productivity or turnaround guarantee.

## Calculation rules

- SLA time starts at ticket creation; response and resolution have independent completion timestamps.
- A resolved/closed ticket is `met` or `breached` based on its recorded resolution completion time. Reopening resumes the original resolution clock.
- An unresolved target is `breached` at or after its deadline, `at_risk` inside its configured threshold, and otherwise `on_track`.
- A priority without an explicit policy mapping is not calculated. Business-hour schedules, holidays, timezone calendars, and pause intervals are not implemented in the ticket workflow.
- ML estimates are never used as SLA targets, deadlines, or actual outcomes.

The prototype policy must be reviewed with the business owner before using SLA statuses as contractual or external performance claims.

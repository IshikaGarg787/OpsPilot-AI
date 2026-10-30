# Automatic ticket priority

New customer and IT tickets receive a priority when submitted. The form no longer asks the submitter to choose one; the admin control remains an optional override.

## Signals and policy

The existing delay-risk and resolution-time models require `issue_priority` as an input, so they cannot directly classify priority. Ticket creation runs those models with a neutral `Medium` baseline, then maps their outputs to the operational `Low`, `Medium`, or `High` priority:

- High delay-risk category or a risk score at/above the model's review threshold adds two points; medium risk adds one.
- A resolution estimate of at least 720 hours adds two points; at least 168 hours adds one.
- The workload forecast adds one point only when at least 60 real ticket-history days are available, at least half of the next seven days are forecast as high-load, and another model signal already indicates elevated urgency.
- Score 2 or higher maps to `High`, score 1 to `Medium`, and score 0 to `Low`. If both ticket-level models are unavailable, the safe fallback is `Medium`.

Workload history below 60 real days is excluded from the decision; bootstrapped history is not treated as observed traffic. The model inputs, priority rationale, and forecast are saved with the ticket. An admin can still override the result when customer impact or business context warrants it.

This is a transparent model-assisted policy, not a model trained to predict priority labels. The current models predict delay probability, resolution time, and aggregate incoming volume; they do not infer business impact from complaint text. Review the assigned priority against organizational urgency rules before relying on it for contractual SLA commitments.

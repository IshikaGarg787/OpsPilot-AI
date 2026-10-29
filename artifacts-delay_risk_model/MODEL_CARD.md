# Model Card — Ticket Delay Risk (delay-risk-v3)

**Target.** `delayed = 1` if resolution time (resolution timestamp − creation timestamp) > 720 hours
(30.0 days; threshold mode: auto). Tickets still open and older than the threshold at the end of the data count as delayed.
Prediction time = ticket creation. Delayed share overall: 28.4%.

**Data.** Help Desk Tickets (Mendeley Data, DOI 10.17632/btm76zndnt.3, CC BY 4.0), file `issues.csv`.
Rows used: 42,730. Exclusions: {'exact_duplicates_removed': 0, 'excluded: missing/invalid creation time': 0, 'excluded: negative resolution time': 0, 'open tickets already past threshold -> labelled delayed': 609, 'excluded: open tickets younger than threshold (unknown yet)': 244}.

**Features (all known at ticket creation).** priority, category, project; calendar features; time-safe history features per
everyone/category/project/priority/reporter/project×category (past delay rate, last-90-day delay rate, open tickets, arrivals in the last 24 h / 7 days).
**Not used:** assignee, status, resolution, comment/contributor counts, started/ended, workflow-step times, processing steps.

**Split.** Chronological 70/15/15 with a label embargo. Train 29,244 | Validation 5,932 | Test 6,410. Test period starts 2022-04-05.
Delayed share: train 30.7%, validation 26.5%, test 19.9%.

**Model.** random_forest ({'max_depth': 14, 'min_samples_leaf': 40, 'half_life_days': 1095}), calibration: sigmoid.
**Decision threshold:** 0.184 (goal: high_recall, chosen on validation). Risk bands: low < 0.4, medium < 0.7, high ≥ 0.7.

**Metrics (test, this run).** PR-AUC 0.493 (guessing = 0.199) | ROC-AUC 0.742 | precision 0.279 | recall 0.789 | F1 0.412 | Brier 0.1352
(validation PR-AUC 0.547).

**Limitations.** One company's help desk, 2007–2023; processes and staffing change. Fields are masked/anonymised.
Type/priority may be edited after creation (not verifiable). Assignee-at-creation is not modelled. Delay is defined only by the threshold rule,
which for this data was chosen automatically from validation results; a business SLA may differ.
Probabilities are calibrated on one validation window and can drift.

**Responsible use.** Use scores to *prioritise attention* (triage), not to judge or penalise agents or reporters. Keep a human in the loop,
monitor precision/recall and calibration on new data, and retrain when the process changes.

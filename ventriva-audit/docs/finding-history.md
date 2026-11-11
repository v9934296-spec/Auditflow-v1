# Verified-fix history

`compareWithPrevious` keeps a finding that a completed scanner has confirmed absent. Later clean audits still carry that row with `change: "fixed"` and `evidence.facts.verifiedFix: true`. If the same issue comes back, the comparison marks it `regressed`.

A scan that does not inspect the relevant file, dependency, or check does not create a new verified fix. If an earlier scan already verified the fix, the row stays `not_retested` and keeps `verifiedFix`, and the report says the fix was not newly confirmed. A later recurrence is still `regressed`. A later completed inspection that finds the issue still gone returns the row to `fixed`.

Retained `fixed` rows are omitted from the score, active P0/P1 counts, remediation tickets, and new/regression alerts.

## Historical audits already stored

Audits completed before this change may have dropped the fixed row on a clean recheck. Those baselines do not contain the verification, and this code does not invent one. Only rows that are still stored as `fixed`, or that already carry `verifiedFix`, can support a later `regressed` label.

Example: detected on audit A → absent and retested on audit B (`fixed`) → absent on audits C and D (`fixed` kept) → present on audit E (`regressed`).

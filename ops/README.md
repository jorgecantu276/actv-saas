# ACTV operations and progress

Use `node ops/status.mjs` from any directory. Optional `--source <checkout>` observes another checkout after verifying its GitHub origin. Optional `--output <file.json>` saves a dated snapshot outside source. `--check` validates readiness offline with no cloud reads. Requires Node and authenticated GitHub CLI; no product runtime is started.

The default source is this checkout. In the local ACTV workspace, `app` selects retained active development and `operations` selects this organization checkout. Run `node operations/ops/status.mjs --source app` there to observe active work. Readiness comes from the operations checkout; both identities are reported. No Git fetch/pull occurs.

| Metric | Definition | Limit |
|---|---|---|
| Items and decisions | Status counts from implementation-readiness.json | Incomplete inventory; never product percent complete |
| Acceptance | Scenario counts by status and kind | Historical tests do not confer candidate acceptance |
| Named owner coverage | Named roles / declared roles | A role is not an assigned person |
| Candidate | Readiness SHA and evidence-index reference | Missing means no qualified candidate asserted |
| Source | Observed SHA, branch, dirty state | Dirty files are not tasks or completed features |
| Exact-source CI | Latest attempt per workflow ID at observed SHA in bounded sample | Missing evidence is UNKNOWN; dirty source never qualifies |
| CI activity | Run counts by outcome among up to 100 latest runs | Mixed branches/workflows/attempts; descriptive, not reliability |
| Integration | Up to 100 open PRs and exact heads | Does not imply independent review or acceptance |
| Publication | Up to 20 recent GitHub releases | Publication is not observed installation |

Cloud failures are explicit unavailable sections and exit code 2, never silent zeroes. Local validation errors exit 1. Reports include UTC observation time and sample limits. Save successive private snapshots for comparisons. A first snapshot cannot establish trends, cycle time, lead time, deployment frequency, change-failure rate or recovery time; those need genuine lifecycle timestamps.

Status never dispatches Actions, modifies readiness or contacts operational services. It counts recorded acceptance outcomes without validating their evidence; evidenceValidation is NOT_PERFORMED and candidate qualification is not inferred. Production installation stays UNKNOWN. Keep credentials, personal data and private configuration outside Git and snapshots. Snapshot output uses exclusive creation; choose a new dated filename for each report.

Update the product report when scope/evidence changes. Readiness is the single acceptance record; the plan owns W0–W7 order/dependencies/exit gates. Project-board cards index packages and never confer acceptance. A PASS requires candidate/configuration/environment, reviewer, result and evidence under the existing evidence rule. W6 release approval and W7 actual installation remain separate.

The `ACTV product record` workflow validates this record/tool only. Existing application CI remains separate; the unified full-release `npm run verify` is still a W1 deliverable.

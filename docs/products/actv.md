# ACTV product and delivery report

Updated November 26, 2026. Supported source candidate **0.2.0-rc.1** consolidates newer ACTV work on codex/actv-supported-candidate. [Composition and limits](../consolidation.md), [manifest](../../ops/source-candidate.json), [product board](https://github.com/users/jorgecantu276/projects/2).

| Product | Outcome | Source progress | Next release gate |
|---|---|---|---|
| ACTV | Complete public registration, folios, private runner history and event-scoped staff operation over one operational core | Newer supported app/backend work consolidated, excluded experiments preserved separately, repeatable source CI added | Full operational baseline/adoption, applicable decisions, hosted/device/recovery acceptance and W6/W7 |

## Development and CI

One candidate includes public/guest Stripe registration, Mi ACTV attendance, organizer workspace, retained staff modules, admin payments, refund recovery, webhook retries and supported shared SQL. Existing-store redirects remain. New storefront and external timing are excluded. Mercado Pago activation is disabled regardless of environment settings; shared SQL114/115 remains for Stripe/cash compatibility.

Independent review identified a lost-provider-binding recovery defect: paid Checkout sessions could no longer recover after the first ~15 minutes of a 45-minute hold. The source fix separates new-session validity from canonical recovery, uses the database order origin to stop before Stripe idempotency keys may expire, and tests late/expired, mismatched-object and old-window cases for online and Terminal. It does not replay provider creation beyond 23 hours; unresolved older cases remain operational review.

`npm run verify` runs lint, types, build, unit tests, payment migrations/financial fixtures, real Edge handlers with synthetic Stripe HTTP, and portal permission/ownership contracts. CI checks the exact PR head and retains .verification/evidence-index.json. The tool records source identity, dirty state, build identity, migration/function hashes, configuration mode and automated results. It makes no production qualification claim.

## Remaining acceptance

The single readiness record retains 15 open items and 29 unrun release scenarios. This source suite supplies bounded evidence, not blanket acceptance. Full production schema/Auth/Storage/jobs and retained in-place adoption are unqualified. Existing staff Auth/profile provisioning still needs trusted payment-staff membership/role synchronization in W2; a profile alone does not grant staff entry. Real tablet/PT210/card/provider operation, complete recovery and W6/W7 remain pending.

Published source, green candidate CI, actual deployment and accepted production operation are distinct. No production deployment is performed by the candidate workflow. The deployed application/backend/configuration identity remains unverified.

## History

Scope and W0–W7 originate in the November 22 ACTV planning review. The November 26 organization baseline established one product, board and metrics; this candidate adds the source consolidation and reproducible checks. The original dirty checkout, excluded experiments and main/deployment history remain intact. Older targets/evidence retain their historical scope. Product progress is not represented as a completion percentage.

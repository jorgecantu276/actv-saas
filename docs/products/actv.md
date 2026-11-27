# ACTV product and delivery report

Updated November 26, 2026. Supported source candidate **0.2.0-rc.5** adds verified linking, refunds, cancellation and attendance history on codex/actv-linking-refunds-history. [Details and limits](../linking-refunds-history.md), [manifest](../../ops/source-candidate.json), [product board](https://github.com/users/jorgecantu276/projects/2).

| Product | Outcome | Source progress | Next release gate |
|---|---|---|---|
| ACTV | Complete public registration, folios, private runner history and event-scoped staff operation over one operational core | Newer supported app/backend work consolidated, excluded experiments preserved separately, repeatable source CI added | Hosted adoption/configuration, applicable decisions, device/recovery acceptance and W6/W7 |

## Development and CI

One candidate includes public/guest Stripe registration, Mi ACTV attendance, organizer workspace, retained staff modules, admin payments, refund recovery, webhook retries and supported shared SQL. Existing-store redirects remain. New storefront and external timing are excluded. Mercado Pago activation is disabled regardless of environment settings; shared SQL114/115 remains for Stripe/cash compatibility.

Independent review identified a lost-provider-binding recovery defect: paid Checkout sessions could no longer recover after the first ~15 minutes of a 45-minute hold. The source fix separates new-session validity from canonical recovery, uses the database order origin to stop before Stripe idempotency keys may expire, and tests late/expired, mismatched-object and old-window cases for online and Terminal. It does not replay provider creation beyond 23 hours; unresolved older cases remain operational review.

`npm run verify` runs lint, types, build, unit tests, payment migrations/financial fixtures, real Edge handlers with synthetic Stripe HTTP, portal permission/ownership contracts, and the full operational staging rehearsal. CI checks the exact PR head and retains .verification/evidence-index.json. The tool records source identity, dirty state, build identity, migration/function hashes, configuration mode and automated results. It makes no production qualification claim.

## Remaining acceptance

The single readiness record retains 15 open items and 29 unrun release scenarios. This source suite supplies bounded evidence, not blanket acceptance. The captured nine-table operational baseline now has clean and retained-record rehearsals on actual local Auth/Storage/PostgREST with schema/grant comparison and inactive job definitions. The profile-only provisioning gap is closed in source through atomic manager-authorized roles, assignments, recovery and revocation. Hosted adoption/settings and the rest of W2 acceptance remain open. Real tablet/PT210/card/provider operation, complete recovery and W6/W7 remain pending.

Published source, green candidate CI, actual deployment and accepted production operation are distinct. No production deployment is performed by the candidate workflow. The deployed application/backend/configuration identity remains unverified.

## History

Scope and W0–W7 originate in the November 22 ACTV planning review. The November 26 organization baseline established one product, board and metrics; this candidate adds the source consolidation and reproducible checks. The original dirty checkout, excluded experiments and main/deployment history remain intact. Older targets/evidence retain their historical scope. Product progress is not represented as a completion percentage.

The [full baseline and staff lifecycle](../staging-baseline.md) documents the new stage, retained identity/evidence checks and explicit remaining release boundaries.

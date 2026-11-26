Current follow-up: source candidate 0.2.0-rc.4 adds [registration snapshots, audited corrections and unified operations](registration-operations.md). Previous candidates added [private evidence, shared receipts and sales recovery](evidence-receipts-recovery.md) and the [complete staging baseline and staff lifecycle](staging-baseline.md). The record below describes the earlier 0.2.0-rc.1 consolidation.

# Consolidation of the November ACTV work

Source candidate: 0.2.0-rc.1, branch codex/actv-supported-candidate, based on the payment foundation and product-standard branch. The immutable tested source SHA is recorded by CI in .verification/evidence-index.json; current Git/PR is authoritative, not the version string alone.

## Included and preserved

Retained public race/folio UI, account entry, private runner attendance, organizer event workspace, staff functions, admin payment tooling, refund recovery, webhook retry leases, health/commission logic, supported shared SQL and tests. Legacy staff interfaces and hook lifecycle issues are corrected so existing lint/type checks can run without rule suppression.

The former development checkout remains intact, including excluded experiments. New store/cart/Stripe-store implementation, external timing components/tests and migrations117/118 are outside candidate composition. Redirect-only routes and password/order recovery to the existing merchandise store remain. The shared order/reporting logic of migrations114/115 is retained; Mercado Pago activation is blocked at the Edge adapter regardless of test credentials. Existing applied database history must be reconciled under W1, never deleted based on this file list.

## Verification and limits

npm run verify is the same local/CI entry point. It executes source checks and synthetic financial/permission/Edge contracts against its newly owned disposable PostgreSQL container. The test fixture is not the complete legacy operational schema; full-schema clean/adoption rehearsal remains open. CI evidence includes source SHA, dirty state, steps, migration/function hashes, build identity/manifest hash and synthetic configuration mode. Hosted/device evidence stays explicitly absent.

No production deployment job is included in candidate verification. This branch does not authorize a release, switch providers or replace the existing installation. Original main/deployment history is preserved; W6/W7 still require complete matching application/backend/configuration and operator-approved recovery and cutover.

The 15 readiness items and 29 release scenarios remain open/unrun unless their actual acceptance is recorded. Passing this source suite is additional bounded evidence; it does not accept an incomplete inventory by percentage.

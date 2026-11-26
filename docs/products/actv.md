# ACTV product and delivery report

Baseline: November 26, 2026. Evidence report, not a percentage-complete estimate.

| Product | Business outcome | Current evidence | Next milestone |
|---|---|---|---|
| ACTV | Complete race/POS replacement: guest registration, confirmed payment/cash, folio, private runner history and event-scoped staff operation | Payment foundation at 9b836c864c6e3f9a1590563dd1c8127b214422b6 has historical CI. Newer application work is uncommitted in the retained checkout. Readiness is NOT_QUALIFIED; candidate unset. | W0 operating baseline/decisions; W1 supported-source consolidation and reproducible verification |

Public registration, Mi ACTV, organizers/staff, folios and payments are capabilities of one product. Existing merchandise store stays unchanged. New store, timing/results integration and external historical migration remain excluded.

| Package | Owner-visible result | Acceptance |
|---|---|---|
| W0 | Know actual operation and equipment | Retained capability/issuer baseline, named authorities and decisions |
| W1 | Reproducible, reviewable candidate | Consolidated source, full staging, shared contracts and safe verification |
| W2 | Preserve records and enforce permissions | Role/ownership, legacy folio and account-link tests |
| W3 | Sell and recover reliably | Money/capacity/retry/refund and real provider tests |
| W4 | Operate existing tablets/printer | Physical receipts/reprints, camera, kits and attendance |
| W5 | Coherent public, runner and staff tasks | Retained-capability parity and role-specific walkthroughs |
| W6 | Prove frozen release in staging | Applicable acceptance, recovery, monitoring and approval |
| W7 | Switch and accept actual operation | Coordinated cutover and retirement of old race issuers |

The [plan](../implementation-plan.md) owns order, dependencies and exit gates. The [readiness record](../implementation-readiness.json) owns decisions, defects, responsible roles and scenarios. No package is newly accepted by this organization change. The dated baseline contains 15 OPEN items and 29 NOT_RUN scenarios; named owners are unset. Recompute with `node ops/status.mjs`. Post-switch checks remain separate from pre-cutover acceptance.

## Evidence boundaries

- **Source:** actv-saas PR #1 contains committed payment foundation. Newer local UI/payment/operational work is outside that commit. This organization branch is stacked on the foundation; it does not consolidate those files.
- **CI:** foundation run [43538253324](https://github.com/jorgecantu276/actv-saas/actions/runs/43538253324) passed. Old green CI does not certify newer source. W1 must establish complete checks; historical lint failures remain recorded in E5.
- **Release:** package.json 0.1.0 is a source label, not an accepted installation. No candidate is bound in readiness.
- **Production:** deployed Hostinger revision, complete backend/configuration identity and device qualification are unverified. Source CI proves none of them.
- **Maintenance:** genuine transaction/recovery alerts and escalation belong to W6. Shared maintenance dashboard stays optional. This change creates no scheduled monitor.

## Basis and limits

Reviewed ACTV chats “Review project progress and scope” (November 22 planning decisions) and “Review ACTV project stages” (November 16 local redesign), current plan/scope/readiness, local Git and GitHub PR/Actions observations on November 26. POS reference: PRODUCT-FAMILY, WORKSPACE, DELIVERY and “Analyze POS Product Family”. Bounded discovery; physical equipment and older artifacts were not revalidated.

Plan/scope/readiness were copied unchanged from the retained planning/development checkout. Some source targets refer to newer local files absent from this organization branch; they are work targets, not implementation claims. Existing dirty work remains intact. W1 still owns consolidation, migration composition and application review.

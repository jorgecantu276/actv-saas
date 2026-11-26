# ACTV supported source candidate

Version **0.2.0-rc.1**, November 26, 2026. This consolidates the retained newer ACTV work into one reviewed source line. The [product board](https://github.com/users/jorgecantu276/projects/2), [scope](docs/project-scope.md), [plan](docs/implementation-plan.md), and [readiness](docs/implementation-readiness.json) remain the business/acceptance references.

## Supported composition

Public race discovery and guest Stripe checkout; Mi ACTV private attendance/account workflows; organizer event operations; retained staff sales/athletes/kits/reports/quotations; payment/refund/reconciliation recovery. [Source manifest](ops/source-candidate.json) identifies functions, migration filenames, configuration names and remaining gates.

The existing merchandise store keeps its redirects and recovery URLs. New storefront and timing/import experiments remain preserved in the original development checkout and are absent here. Shared SQL migrations 114/115 remain because Stripe/cash use their order/reporting contracts; unfinished Mercado Pago checkout cannot be enabled by environment settings. Timing migrations 117/118 are omitted from this source candidate. Never remove applied migration history or replay these files blindly on an existing database.

## Reproduce verification

Use Node 24, Git, Docker with Linux containers, and `npm ci`. Deno 2.9.6 is pinned in devDependencies. Then run:

```powershell
npm run verify
```

This runs lint, Node regressions, readiness validation, TypeScript, the Next build, Edge unit tests, a fresh PostgreSQL financial fixture, actual Edge handlers against that fixture, and portal permission/ownership contracts. It always creates its own labelled loopback-only disposable container and removes only that container. Inherited ACTV/provider/backend configuration is stripped and replaced with synthetic build/test settings. It does not use an existing local or hosted database, charge, send email, print, migrate production or deploy.

PostgreSQL durability settings are relaxed only inside that disposable synthetic fixture. These checks prove transactional contract behavior, not crash durability or production performance. The fixture is a bounded payment/portal schema, not a copy of the full operational schema.

Logs and a source/configuration-mode/build/schema/function evidence index are written under ignored `.verification/`. GitHub CI runs this same command on the exact PR source SHA and retains its evidence artifact. Its workflow performs candidate verification only; production deployment requires the plan's separate W6/W7 evidence and acceptance.

For source development use `npm run dev` with isolated approved configuration. For status use `node ops/status.mjs`; it distinguishes source, recorded readiness, CI, publication and actual installation. Record validation and CI do not automatically accept an open release scenario.

## Remaining release gates

The source version does not close full-schema/adoption, real tablet/PT210/card, hosted provider/configuration, recovery, operating-policy or cutover acceptance. See W0–W7 and [candidate details](docs/consolidation.md). Existing private records and the original dirty checkout were preserved.

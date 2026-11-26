# ACTV — races, folios and payments

One product: public race registration, Mi ACTV and staff/organizer operations over the existing Supabase core. Merchandise stays in the existing store. Registration, folios and payments are capabilities of ACTV, not separate products.

Start with the [product report](docs/products/actv.md), [scope](docs/project-scope.md), [implementation plan](docs/implementation-plan.md), [single readiness record](docs/implementation-readiness.json) and [operations/metrics guide](ops/README.md).

This branch adds organization and reporting. It does not consolidate newer uncommitted application work or qualify a release. Plan/readiness/scope were recovered unchanged from November 22 planning. Their targets can refer to newer development files absent here.

## Working agreement

1. Start with the business task and observable acceptance in W0–W7. The plan owns order and gates; readiness owns decisions and evidence.
2. Implement bounded changes through reviewed PRs. Preserve existing records and payment/folio/access contracts. Keep excluded experiments separate from supported release composition.
3. Use a separate reviewer for the final revision and applicable automated checks on the exact candidate.
4. Distinguish requested, implemented, verified, published and installed. CI does not accept real devices, providers or cutover.
5. Release through W6/W7 with ACTV acceptance and recovery evidence. Private records, credentials and configuration stay outside Git.

## Status

```powershell
node ops/status.mjs --check
node ops/status.mjs
node --test ops/tests/status.test.mjs
```

Status uses Node and authenticated GitHub CLI. It reads source metadata, CI, PRs and releases without contacting the database or operational devices. See the operations guide for private snapshot output and observing the retained development checkout.

## Application development

`npm ci` and `npm run dev` run source development with approved isolated Supabase configuration and synthetic state. Existing payment checks are documented in [payment-pilot](docs/payment-pilot.md). The unified full-release `npm run verify` remains W1 work. The existing ACTV PDV workflow has an explicit production-dispatch option; status does not dispatch it. This organization change leaves application/deployment logic unchanged.

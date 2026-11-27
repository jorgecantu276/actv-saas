# ACTV staging and release delivery

`ACTV candidate verification` establishes clean exact-source CI. A successful
canonical main push automatically triggers `ACTV release delivery`, which
packages and deploys that exact verified source to the enrolled synthetic stage.
The controller runs reviewed default-branch code, checks the actual GitHub run
through the API, rejects PR/fork/failed triggers and skips superseded main runs.
Manual preparation/deployment uses the same normalized implementation path;
production always requires explicit main dispatch and W6/environment approval.
A source package is not a precompiled binary: Hostinger builds
the pinned payload with the selected target configuration and Node 24. The
release identity binds its source tree, migration/function/job inputs, public
configuration identity and source verification evidence. The source/payload
contract is portable; hosting is an adapter.

## Enrolled targets

The authoritative public bindings are `ops/staging-target.json` and
`ops/production-target.json`. Staging is the existing
`https://staging-pdv.actv.mx` site with the separate free Supabase project
`ACTV-Staging` (`fwbvbppwixzbearrlsza`). It never uses the production backend
`ndjqyootqtnygyzhbjrz`, live provider mode or copied business records.
Production remains `https://pdv.actv.mx` and its existing backend. A target
change requires a reviewed binding change, not an environment-variable override.

The current Supabase organization reports Free. The new staging project used
available free capacity and did not change billing or purchase an add-on.
Hostinger staging and WordPress share the existing hosting plan's compute.
Run only bounded functional smoke there: a distinct hostname and database do
not isolate CPU/process/memory load. The W6 burst workload needs separately
accepted compute capacity. Free staging can pause; availability is observed,
never inferred from a successful old run.

## One-time configuration

Use GitHub environments `actv-staging` and `actv-production`. Restrict staging
to the reviewed staging/integration branch and main; restrict production to
main and require the release owner's approval. The approval remains a
procedural control, not cryptographic independent-review proof. Keep the final
independent source review and the actual operator's acceptance evidence.

Staging environment secrets:

- `SUPABASE_ACCESS_TOKEN`: management access used only for the enrolled synthetic
  staging backend; never provided to a production database job.
- `ACTV_APP_ENV_JSON`: the complete real app configuration object, with
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ACTV_PUBLIC_RACE_MODE`,
  `ACTV_LEGACY_WORDPRESS_ORIGIN`, `ACTV_STAFF_ORIGIN` and optional telemetry setting. The backend
  URL must match the enrolled project. The provider access key stays in Edge
  secrets, not in this app configuration.
- `HOSTINGER_API_TOKEN`: the hosting credential, available from the existing
  repository secret or a narrower environment secret.

Hostinger's environment-read API masks values. Never copy its `********`
values into a replacement request. Deployment sends the full desired real
configuration over stdin, then builds a fresh app because public values are
compiled into browser output. The reviewed target includes the public anon-key
hash, race mode, WordPress origin and staff origin, so changing those values
requires a new target binding and release identity. Server credentials are never
hashed into that identity. Public credentials must be an anon-role JWT for the
target or a publishable key; a service-role/secret key is refused in that slot.
Read-only Auth checks verify both keys against the selected backend before any
hosting mutation. Secret values, raw CLI logs and private files
never enter the source/published evidence artifacts.

The staging backend adapter checks the real project identity, refuses unknown
existing schema, verifies platform-owner default privileges already match the
captured baseline, then installs schema-only baseline and ordered migrations.
Its private `actv_release.migrations` ledger binds hashes and records each
forward migration in the same transaction. It refuses changed or reordered
applied history. The candidate's explicit function list is deployed with its
existing authorization contracts. Excluded provider functions are not added.

This prepares the application contract with new sales paused. It does not enroll
Stripe sandbox credentials/webhook, SMTP, reconciliation/cleanup schedules,
external alerts or physical devices. The backend receipt states those remaining
gates. No worker or new sales is silently activated by application delivery.

## Automatic staging and manual preparation

After a reviewed main merge passes candidate verification, follow its automatic
staging run. Do not dispatch another deployment for the same completed trigger.
The controller verifies event type, canonical repository, workflow path, exact
SHA/run and current main identity before staging can obtain environment secrets.
Concurrency serializes the stage; a late successful old-main run is skipped.

For a deliberate manual preparation or rehearsal, dispatch
`.github/workflows/release.yml` on the reviewed branch, with:

1. `source_sha`: full 40-character commit with successful candidate verification.
2. `ci_run_id`: that exact verification run, including its retained evidence.
3. `target=staging`.
4. `deploy=false` to prepare only, or `deploy=true` for the enrolled stage.

The workflow reads the successful run through GitHub, downloads its exact
source-evidence artifact, validates every required verification step and builds
a source payload from Git objects. Its release manifest pins the Git tree;
the hosting adapter reconstructs that tree and verifies every uploaded source
file plus the two declared identity overlays. Missing/extra/changed files,
symlinks and a dirty source checkout are refused.

The backend is updated forward only on the enrolled synthetic project. Hosting
then saves an intent before configuration/build mutation, uploads the prepared
payload, observes the exact returned build ID and checks `/api/version` plus
bounded read-only page routes. The receipt explicitly distinguishes that smoke
from transaction/provider/device/load acceptance. The hosted build ID and
previous compatible build reference are retained.

For a lost mutation acknowledgment, inspect the saved intent and actual host
build history. Never automatically resubmit a deployment or assume the last
upload failed. A repeated backend invocation reads its atomic ledger before
applying a pending migration. An unknown bootstrap state requires reconciliation;
it never resets an existing database to make the check pass.

## Production promotion

Production deployment dispatch is available only from main, for source in
main's history. The production environment must hold target-bound records:

- `ACTV_STAGING_RECEIPT_JSON`: the observed exact-source staging receipt.
- `ACTV_BACKEND_RECEIPT_JSON`: the separately accepted production backend
  deployment/maintenance receipt with the same source/tree, project and full
  contract hash; its `status` is `contract_deployed`, `salesPaused=true` and its
  observation evidence is hashed. The app workflow cannot manufacture this by
  applying production SQL.
- `ACTV_W6_APPROVAL_JSON`: `actv-w6-approval-v1`, exact `sourceSha`,
  `productionTargetSha256`, `stagingReceiptSha256`, `w6Status=accepted`,
  `newSalesPaused=true`, `backupReceiptSha256`, `recoveryReceiptSha256`, distinct
  named `engineeringReviewer` and `operationsReviewer`, and `scenarios` entries
  with `id`, `status=PASS`, `evidenceSha256`. These references identify the
  retained genuine evidence; recording hashes cannot make unperformed tests pass.
- `ACTV_APP_ENV_JSON` and the hosting credential for the actual production app.

Before any production mutation, approval validation checks the exact staging
release manifest, production bindings, complete applicable W6 scenario coverage,
closed decisions/evidence, assigned owners, inventory, backup and recovery.
The current readiness record remains unqualified, so it cannot pass this gate.
W7's explicitly post-switch outcomes are not fabricated as predeployment passes.

Production database/functions/jobs maintenance, coordinated old-writer shutdown,
actual equipment/provider acceptance, sales reopening and first-shift acceptance
remain the existing W6/W7 procedure. The app workflow does not migrate production
or open sales. Deployment metadata does not establish transactional health.

## Recovery

Keep the hosting intent, exact source package, observed release/build ID and
backend state together. A failed build does not authorize a second allocator or
an old database restore. Before new obligations, use the rehearsed compatible
app recovery. After any new order/attempt, pause new creation, retain callbacks,
lookup and reconciliation, and use compatible app rollback or forward repair.
Restore of an old database would discard new cash/provider obligations and is
not an application rollback.

Hostinger supports an instant application rollback to retained successful
builds; the responsible operator verifies schema/configuration compatibility
and running `/api/version` afterward. Do not automatically trigger an app
rollback without proving that compatibility. Recovery time, retained cash and
provider records, backup restore and responder escalation still need W6 proof.

Verification: `node --test tests/release-delivery.test.mjs`, `npm run test:unit`,
lint, TypeScript, production build and mandatory exact-source CI. Official API
references used: [Hostinger CLI](https://github.com/hostinger/api-cli/tree/v5.0.0),
[Node versions](https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/),
[Supabase Management API](https://supabase.com/docs/reference/api/introduction),
[Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

# Complete operational baseline and staff lifecycle

Source candidate 0.2.0-rc.2 builds on the merged ACTV source. The baseline is derived from a schema-only export and a fresh November 26 read-only production catalog capture. No production business rows, Auth identities, object names, credentials or Vault contents are copied.

## Reproduce

Use Node 24 and Docker Linux containers, then `npm ci` and `npm run verify`. The focused command is `npm run test:staging:full`. Supabase CLI 3.1.0 is pinned in devDependencies.

The full command creates a unique local project and private temporary context on an owned Docker bridge. Published service ports bind to loopback. Auth, PostgREST, Storage, mail capture and the actual Supabase database run locally; optional UI/realtime/analytics services are excluded. Provider/cloud configuration is stripped. The command never targets a linked hosted project, deploys, charges or sends real email. Cleanup targets only its own project and temporary directory.

## What the baseline includes

- All nine operational public tables, 97 columns, defaults, identities, constraints, indexes, sequences, legacy functions, RLS and grants from the captured application schema.
- The actual local Auth schema/service and application profile trigger. User-supplied role metadata cannot grant staff authority after migration.
- The actual Storage schema/service, evidence bucket configuration, observed policies and SQL-deletion protection. A synthetic retained evidence object is uploaded through the Storage API; reference and bytes survive adoption, and API deletion is tested separately.
- The observed daily cleanup job definition and schedule on real pg_cron, explicitly inactive during deterministic tests. Relevant extension and runtime identities are recorded.
- Both clean application migration and representative in-place adoption. Synthetic retained Auth users, profile IDs, events, athletes, folios, evidence, clubs, clients, services and quotations exercise the existing constraints and relations.

The checked-in catalog is metadata evidence, not an acceptance result by itself. The runner compares recreated application schema facts against it and compares clean/adopted schema outcomes. Its evidence records comparison scope and actual runtime images. Supabase-managed runtime versions can differ from the hosted service; real hosted configuration and operating acceptance remain separate gates.

## Staff lifecycle

Manager-authorized server actions and one atomic database RPC synchronize the profile mirror, authoritative staff role/active state and event assignments. Direct profile-role edits cannot serve as a second authority. Audit records retain actor, before/after and target identity.

| UI role | Authority |
|---|---|
| Administrador | Active manager; global administration and manager-only financial operations |
| PDV ACTV | Active cashier across events; no manager/refund authority |
| Cajero | Active cashier restricted to assigned events |
| Moderador | Assigned-event selling, lookup, kits/attendance and retained event operations; no global manager/refund authority |
| Sin acceso | Retained identity/history, no active staff grant |

Auth creation and the database cannot share a transaction. The trusted server marks a pending staff identity; failed or uncertain activation remains explicitly unconfirmed and can be retried using the same ID/email. Existing accounts are adopted only through an explicit manager action; their ID and password are preserved. Neither profile labels nor signup metadata automatically enroll staff.

Offboarding changes active authority and clears assignments while preserving Auth identity and historical foreign keys. Existing sessions lose database access without waiting for token expiry. A transaction lock protects concurrent manager changes and prevents removal of the final active manager. Password resets require an active authorized staff target; new/reset staff passwords require eight characters.

The first trusted manager still requires deliberate bootstrap under the actual deployment's accepted owner mapping. The migration does not elevate every legacy profile labelled Administrador.

## Evidence and remaining gates

The full staging artifact contains schema comparison, clean/adoption results, actual Auth/PostgREST/Storage contract results and runtime identities. The parent evidence index hashes it together with source/schema/function/build evidence. Ephemeral service keys and raw CLI output are excluded from artifacts.

Preserving the observed public evidence bucket/policies does not accept privacy or retention. Legacy direct SQL deletion of Storage metadata is protected; a successful fake table deletion would be misleading. The baseline exposes that contract, while G1 still owns the application cleanup/access changes and operating proof. Local API object deletion is not acceptance of the scheduled production cleanup job.

These checks close the thin-fixture and profile-only provisioning gaps in source. They do not authorize production adoption or close all W1/W2/W6 requirements. Hosted settings, all retained operator workflows, devices/providers, full recovery and the coordinated cutover still need their own evidence.

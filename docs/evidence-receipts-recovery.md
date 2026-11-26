# Private evidence, shared receipts and sales recovery

Source candidate 0.2.0-rc.3 extends the captured staging baseline. It is a candidate for reviewed staging deployment; no hosted deployment or production policy approval is implied.

## Kit evidence

Migration 122 makes `evidencias_kits` private, removes its public policies and retires the old SQL object-deletion trigger/function and daily job. The replacement viewer obtains an authorized object reference and downloads through authenticated Storage access. Possession of an old public URL grants no access. Current event assignments and active staff authority apply to each read and upload.

Legacy references keep their original values. An authorized manager must approve the exact known Supabase origin through `actv_evidence_adopt_legacy(p_origin)` before those references become viewable. This maps existing objects without fetching arbitrary URLs or inventing old actors/dates. Rehearse this adoption with the replacement viewer during the coordinated switch; changing the live bucket before deploying its compatible viewer would interrupt old clients.

New handovers use a persisted request identity, event/registration-bound object path and atomic finalization. A lost response is recovered against that identity. A browser must never delete an object to compensate for an uncertain database commit. Competing handovers cannot commit two evidence records for the same registration.

Retention starts disabled. An active manager records an explicitly approved duration through `actv_evidence_policy(p_days)` and can apply an evidence hold with `actv_evidence_hold`. Unknown legacy handover dates remain unknown and cannot expire through a guessed timestamp. Approval of the actual retention origin, duration, orphan grace, exceptions and restore handling remains a business/privacy gate.

The cleanup worker claims persisted queue entries with leases, removes objects through the supported Storage API and confirms removal before clearing the matching reference. Failures remain visible for retry; an uncertain deletion is reconciled rather than reported as completed. `actv_evidence_cleanup_status()` exposes policy, work and unmapped legacy references to managers. Hosted scheduling, independent failure/heartbeat alert delivery, approved retention and restore exercises remain release requirements.

Deploy matching `actv-kit-evidence` and `actv-evidence-cleanup` handlers alongside the app during an approved staging rollout. The cleanup endpoint requires `Authorization: Bearer <ACTV_EVIDENCE_CLEANUP_SECRET>` with a dedicated secret of at least 32 characters. Store it through the existing secrets management route and invoke the worker with POST from the reviewed scheduler. Never put it in browser configuration, source, logs or evidence artifacts. Configure and prove the schedule/alerts in staging; none is activated by this candidate.

## Sale receipts

`actv_sale_receipt` accepts one identity: an order UUID, registration UUID, or event UUID plus folio. It rechecks current staff/event scope and returns the complete issued sale from server records. Confirmed receipts require valid payment and issued folios. Historical unlinked registrations retain their original identity/folio and are clearly labelled payment unverified; they do not gain a fabricated capture.

Caja, Reportes and ListaAtletas use one sale renderer and a bundled ACTV wordmark. It produces participant/organizer copies at 58 mm, uses the same identities on reprint, and keeps quotations separate. Printing revalidates the receipt and reports a request, with paper output unconfirmed. PT210/Android readability, paper-out, reconnect and QR use still require actual station qualification.

## Pause and original-order recovery

Migration 123 installs the server gate **paused**. An active manager uses `actv_set_sales_pause(p_paused,p_reason)` to authorize opening or pause new sales, with an audit history. Stale or direct clients cannot bypass the database gate by creating another request ID. Pausing does not disable events or callbacks: accepted transactions can settle, preserve their original folios, reconcile and be looked up/reprinted.

Provider mutations require a durable authorization for the exact canonical attempt before contacting Stripe. Authorization serializes with pause; work authorized before pause is an accepted obligation. During pause, bounded recovery can reuse that original authorization, while fresh provider attempts are blocked. This does not authorize a new tender when an earlier payment is uncertain.

Caja loads recent/pending orders from the server through `actv_staff_recent_orders`, including their original request/cart/channel and shift information. Recovery remains scoped to the active operator and current event permission, and survives loss of browser session storage. Reopen the original order and check its status before considering another sale.

## Verification and release boundary

`npm run verify` retains the financial/Edge regressions and runs private evidence, actual Storage cleanup, shared receipt and sales gate/recovery contracts against owned local Supabase services. The full staging artifact records each suite separately and is hashed by the parent exact-source evidence index. Synthetic tests deliberately open only their owned gate; the migration default stays paused.

The captured legacy baseline remains faithful to observed production metadata, including the old public bucket and failed cleanup design. Candidate migrations change it additively, and both clean installation and retained-data adoption must reach the same schema. No production records, identities or photos are copied into these tests.

Hosted configuration/scheduler acceptance, owner mapping, approved policy, actual hardware/providers, full recovery and alert drills, W6 approval and W7 cutover remain open in the readiness record. Do not mark a broad acceptance scenario passed solely because its local contract tests pass.

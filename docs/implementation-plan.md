# ACTV total replacement implementation plan
November 22, 2026

Revision 4: current Mexican privacy/consumer/payment obligations join the scope benchmark, contracts and acceptance scenarios in one readiness record. These are implementation requirements; they are not claims that the controls are already running or that compliance is demonstrated.

Discovery addendum, November 22: historical ACTV research and real external cases exposed further defect-closure and operating-policy gaps. ACTV-discovery-gaps-and-real-cases-2026-11-22.txt is the G1–G8 register for W0/W6 below; ACTV-historical-research-review-2026-11-22.txt indexes earlier work and existing proofs. Discovery remains OPEN until these items have explicit owners, decisions and acceptance evidence. The prior plan review covered the requirements known at that snapshot; it was not exhaustive business discovery.

Current execution record: repository docs/implementation-readiness.json, mirrored as ACTV-implementation-readiness-2026-11-22.json. Maintain capability/decision/defect and acceptance status there; this plan owns delivery order and gates. Dated research reports remain evidence. The record covers G1–G8, foundation F1–F5 and legal L1/L2, all OPEN, candidate unset and acceptance NOT_RUN. W0 extends it for actual retained capabilities and names the accountable people; the inventory is explicitly incomplete. W1 uses it with the existing release evidence index rather than building another workflow system. No approval or progress percentage is inferred from historical passes.

Recent-scope benchmark: ACTV-scope-benchmark-US-Western-Europe-Hugging-Face-2026-11-22.txt compares 2025–2026 US/UK operating examples and a European ticketing postmortem. Hugging Face resources inform the evaluation method only; no external model score or case-study metric qualifies ACTV. The readiness record's benchmark_method reuses existing scenario IDs without adding a platform, model runtime or new acceptance inventory.

Mexico applicability review: ACTV-Mexico-privacy-and-payment-compliance-review-2026-11-22.txt maps current official law to observed gaps and unverified facts. L1/L2 own the additional evidence, using existing support/payment/accountant processes. ACTV must identify its actual controllers, entities, purposes, vendors, notices, rights contact and payment responsibilities. Financial-regulatory, minors/digital-platform, fiscal and subscription obligations are assessed against the real service; they are not assumed universally or waived because ACTV is small. Benchmark execution was canceled by the user; the resources remain references.

## Result to deliver

One replacement application on Hostinger, one Supabase operational core, and the existing tablet/printer workflow. Build and test separately; switch the complete race/POS operation once it passes; turn the old race/POS application off.

Three experiences use the same accounts and business rules:
- Public: races → guest registration → payment → folio.
- Mi ACTV: next race/folio first, attended races underneath as a clean list.
- Operations: one event workspace for organizers and staff, with permissions controlling registrations, Caja, kits, attendance and money actions. Secondary staff administration retains the required athlete, club, user, reporting and quotation functions.

Keep the existing merchandise store unchanged. Do not import external timing/results, WordPress/Sheets order history, passwords or old external accounts. Preserve existing Supabase operational records IN PLACE; that is continuity of this application, not an external data-migration project.

Keep the locally tested SQL/Edge payment foundation. Do not port payments to a newly written backend, split into microservices, buy new readers or build a printer server just to make the diagram smaller. One logical operational core can contain separate payment endpoints and database functions.

## Shared contracts

- One event lifecycle and one capacity/folio allocator across online, cash and supported physical-card sales.
- Order/item IDs identify attempts before payment; registration IDs and folios exist after issuance. Keep buyer, participant and account link distinct.
- New folios require authoritative confirmed capture or explicitly recorded cash. Retrying a request, webhook or print never creates a second charge or registration.
- Existing event/registration IDs and folios remain intact. Existing valid entries count toward capacity. Missing historical payment proof and account ownership remain explicit, not fabricated.
- Every operation enforces actor/event access in the backend. A profile role label or hidden UI control is not permission.
- Kit collection, attendance, printing and payment are separate facts. Attendance history needs no timing feed.
- Financial changes alone cannot erase the recorded attendance observation. Authorized personal history distinguishes that observation from current entry eligibility, subject to lawful retention/rights handling; public recognition follows its approved rule.
- Each registration preserves its accepted choices and applicable consent; profile edits cannot silently rewrite past entitlements. Annual editions use distinct event records.
- An unknown kit-update result is recovered before retry or file deletion. A recorded state does not by itself prove the physical kit was handed over; an interrupted handover needs an authorized, audited resolution.
- Direct tablet-to-printer operation is required. The real payment handset must be identified and qualified; its compatibility cannot be inferred from the tablet model.

## Work packages and dependencies

### W0 — CAPTURE THE REAL BASELINE
Owner: engineering with an ACTV operator; configuration ownership with ACTV.
Dependencies: none.

Work:
  1. Record the actual production workflows and required capabilities. Compare deployed behavior with reviewed source; the July Hostinger upload has no verified Git SHA. Retain a recoverable application artifact/hash and configuration-name inventory.
  2. Inventory existing Supabase schema, Auth identities, grants, Storage and jobs without copying personal data into planning files. Record production counts and IDs as reconciliation baselines under authorized operational handling.
  3. Identify every current race-sale/folio issuer: POS, old public race URLs, Woo race checkout, custom PHP callbacks and Apps Script/Sheets handoffs. Separate these from the merchandise store that stays live.
  4. Inspect the Samsung tablet's browser/app, Android print service, PT210 connection, printer sharing, camera and card handset/provider. The tester discovers these on-device; the client does not need to know an app name.
  5. Establish isolated staging access/capacity and test payment accounts. Verify actual database AND kit-evidence backup/restore coverage. Agree with the responsible ACTV owner on the maximum recovery-point/data-loss window and target recovery time; record any missing capability or added cost before production is scheduled. Any new paid resource or replacement hardware is an explicit decision, not an assumed purchase.
  6. Carry G1–G8 from the discovery register into this same capability/decision matrix. Map older defects to current fixes, explicit dispositions and remaining proof; do not assume every old defect is still open or already solved by generic parity. Settle required event fields/consent, registration snapshots/cutoffs/capacity units, group-refund and race-change rules, kit/attendance/fallback operation, burst/abuse behavior and public-routing boundaries with the appropriate ACTV owner. Unconfirmed features remain decisions, not automatic additions.
  7. Close L1/L2 discovery with named privacy contact and legal/finance authority: collection purposes/classes and controller/vendor/organizer roles; current notices/consent or applicable exception; rights/incident procedures; retention/holds; actual seller/inclusive price, refund/receipt/CFDI and provider responsibilities. Assess minors/public-sharing and the October 2026 digital-platform decree explicitly. Keep private runner history; unqualified public minor sharing cannot be launched. Confirm retained store/service boundaries without building a replacement store or treating foreign hosting as automatically prohibited.

Deliverables: completed W0 sections in the single readiness record, referencing the capability/parity and issuer/URL inventories; device qualification record; full-schema baseline; environment access checklist; production artifact reference. Reuse existing inventories instead of retyping their findings into new reports.
Exit gate: every current workflow is marked KEEP, REDESIGN WITH SAME CAPABILITY, or ALREADY EXCLUDED BY CLIENT. G1–G8 and L1/L2 have assigned authorities, explicit policy/applicability decisions or bounded discovery tasks and acceptance targets; required decisions are resolved before the affected work package passes. No unassigned staff feature and no unidentified race issuer is accepted for cutover.

### W1 — CONSOLIDATE ONE SUPPORTED RELEASE AND STAGING
Owner: engineering.
Dependencies: W0.

Work:
  1. Consolidate the existing dirty/uncommitted local work into one reviewable release branch and immutable candidate revision. Preserve unrelated work and experimental source separately.
  2. Define a release manifest: app SHA, database baseline/migrations, Edge function revisions, configuration names/modes, Auth redirects, provider destinations, scheduled recovery, receipt template and station test evidence.
  3. Exclude new store and timing experiments from supported release composition. Do not delete migrations by name: Mercado Pago changes 114/115 contain generalized order/reporting dependencies used by Stripe/cash. Retain or extract those shared dependencies with the unfinished feature disabled. Timing 117/118 can be omitted deliberately; event-detail 119 depends on 116, not timing. Preserve applied migration history in any environment that already has those versions.
  4. Reproduce the FULL production schema structure with synthetic old/new records in isolated staging. Include profiles/Auth trigger behavior, clubs/clients/services/quotations, Storage policies and jobs. The limited payment test stub is not the full staff system.
  5. Establish a reviewed adoption baseline because production has existing tables but no recorded Supabase migration history. Do not reset production or mark unapplied changes as applied. Rehearse a clean supported upgrade and an in-place upgrade from representative existing rows in disposable staging.
  6. Deploy matching app, reviewed schema/functions and configuration to staging, using safe test providers and test email. Record manual setup steps where full automation adds no useful protection. For migration inspection with the currently installed CLI, use an explicit staging target and `db push --dry-run --skip-vault`; the CLI documents Vault updates before migrations unless skipped. A dry-run label alone must not be treated as permission for secret changes.
  7. Complete the five domain rows in docs/implementation-readiness.json: Events/capacity; Registrations/account claims; Payments/recovery; Receipts; Access/provisioning. Name authoritative module paths and accountable people, then link the shared input/output/state/error contracts and invariant tests. One engineer may own several areas. Reuse existing SQL/Edge rules and shared types/validation. Screens consume these contracts; they cannot independently price, allocate folios, prove payment or grant access. Contract changes update the record and affected producer/consumer tests in the same reviewed change.
  8. Add one `npm run verify` entry point and matching required CI checks for lint, types/build, supported migration/financial tests and shared-contract/permission regressions. It runs only against disposable local/CI test targets, rejects production targets, and cannot deploy, mutate hosted secrets, charge or print. W1 establishes the harness and existing baseline; W2–W5 add and pass the tests for their own contracts; W6 requires the complete suite to pass. Resolve current lint failures in supported code; do not obtain a pass by disabling the checks. Keep the checked-in release checklist small. CI produces one evidence index containing the candidate SHA, artifact/schema/function digests, non-secret configuration revision/mode, automated results and references to hosted/device/operator evidence. The deployment check rejects missing, failed or mismatched required evidence. Rerun automated checks for each candidate; reuse manual evidence only when the maintainer records that its relevant code, contracts, configuration and device versions are unchanged. Money/access/schema changes require recorded review by a responsible maintainer before release.

Targets: .github/workflows/actv-pdv.yml; package.json; supported test/check scripts; supabase/migrations/*; supabase/config.toml; tests/staging-base.sql; tests/staging-payments.mjs; shared contracts; payment functions/operations configuration; docs/implementation-readiness.json; README onboarding.
Exit gate: a clean environment can reproduce the candidate and baseline verification commands; every core contract has an authority, owner and test plan, with new tests passing in its owning work package; excluded experiments are not launch dependencies; app and backend identify the same release; no staging process targets production money, email or devices accidentally. Record required build configuration and supported runtime versions without credentials; replace generic deployment onboarding with the actual Hostinger/Supabase procedure.

### W2 — UNIFY THE CORE RECORDS AND AUTHORIZATION
Owner: engineering; ACTV operator verifies legacy-record treatment.
Dependencies: W1.

Work:
  1. Keep current Supabase Auth/user/event/athlete/registration IDs in place. Define explicit authorized reads and eligibility treatment for pre-cutover registrations without creating fake captures or blindly setting new eligibility flags.
  2. Fix organizer roster, receipt/kit lookup and capacity queries so valid pre-cutover entries remain usable. Keep unverified payment state visible to authorized staff.
  3. Create one manager-authorized provision/update/offboard path for profiles, payment staff, assigned events and organizer memberships. Preserve existing Auth IDs; fail closed if provisioning partly fails. Editing a role label must not silently leave financial permissions unchanged. Preserve the current moderator's required assigned-event operations without granting global refund or financial-manager rights merely to fit the current manager/cashier enum.
  4. Review/enforce the new row/operation permissions for public visitors, runners, organizers, cashiers and managers. Remove the current broad access from the supported replacement contract after full-schema staging tests.
  5. Unify staff/organizer event create/update/publish/pause using the same event/configuration records. Replace the current hardcoded sandbox event-creation behavior with explicit, authorized environment handling and payment readiness.
  6. Define verified registration-to-account linking for self purchases, physical purchases and companions. Use purchase-contact verification for buyer access and an authorized, single-use/expiring participant claim or invitation for personal ownership. Define corrected contacts, duplicate/reused/expired claims, staff-assisted verification and voided/reissued entries. No automatic matching by name, operator attribution or purchaser identity.
  7. Set the capacity-release rule explicitly. Current `actv_payments.used()` counts all registrations, including voided/refunded rows, plus active reservations. Preserve existing valid places; decide whether/how confirmed cancellations release a place before changing the allocator. Retain one sequence seeded from existing event folios, including relay suffixes.
  8. Implement G3/G5: accepted participant/package/shirt choices and applicable consent are registration-specific snapshots across online and physical sales. Enforce the approved field matrix on direct API paths. Preserve old missing evidence as unknown. Audited corrections retain original values and cannot silently transfer ownership; next year's edition cannot reuse an old edition's records. Decide postponement/cancellation remedies and attendance observation/correction with ACTV before accepting those transitions.
  9. Implement approved L1 collection/notice/permission rules, private-by-default optional sharing and proportionate identity/representation checks for rights requests. A race waiver is not automatically privacy consent. Use the named contact and a restricted request log/procedure where adequate; apply legal retention/blocking exceptions and restore treatment without disclosing companions' data. Do not add facial recognition, unnecessary identity documents or a separate compliance platform.

Targets: migrations 100/103/114/116/119 and new reviewed changes; app/actions/usuarios.ts; components/TabUsuarios.tsx; components/TabEventos.tsx; app/organizadores/*; app/mi-actv/*.
Exit gate: all role/ownership tests pass; staff creation/assignment/revocation works; existing current/future folios remain accessible to authorized operations; new physical and companion entries can link to the correct runner.

### W3 — FINISH THE SHARED ORDER/PAYMENT/RECOVERY CONTRACT
Owner: engineering; ACTV finance/operations verifies provider ownership and operating policy.
Dependencies: W2; physical-provider identification from W0.

Work:
  1. Keep existing server price/capacity checks, reservation/issuance transactions, signed notification inbox, idempotency, refund eligibility and scheduled recovery.
  2. Make every sales channel use that same lifecycle. Stripe is the online launch path. Do not enable an incomplete second general online checkout. If the existing physical device requires another provider, implement only its verified required counter path against the same ledger.
  3. Add scoped server lookup of pending/recent staff orders and issued receipts, so losing sessionStorage, closing a tab or restarting the tablet does not require a new payment attempt.
  4. Define a server-issued receipt DTO with order/event/registration IDs, folios, participant/package details, confirmed amount/channel and reprint semantics. Do not reconstruct authoritative receipt data from large client-side athlete lists.
  5. Confirm guest order re-entry, account activation and transactional email responsibilities. Test actual staging email delivery rather than inferring it from Stripe receipts.
  6. Validate refund/dispute/reconciliation behavior, cash close/deposit matching, pending-card cancellation and missed-notification recovery in the supported provider/device modes.
  7. Define one server-enforced creation gate across guest checkout and staff cash/card entrypoints, closed by default during cutover. It rejects new orders/payment attempts while preserving accepted-order lookup, callbacks, reconciliation, permitted original-attempt recovery and same-folio reprints. Do not implement this by deactivating the event: current issuance rejects inactive events, and the online-only flag does not cover staff sales. Do not block fulfillment of already accepted payments.
  8. Implement the approved G4 outcome for partial/group refunds, kit/capacity effects, fee reversal/funding and paid-without-place support. Retain the current safety hold until a reviewed replacement rule exists; optional UI restrictions cannot disable provider-originated refunds/disputes. Correct the runner-history read boundary so financial eligibility does not erase the observed-attendance fact. Reuse existing tested recovery; add measured server admission limits for holds/claims/requests without blocking accepted work or legitimate shared-Wi-Fi guests.
  9. Implement L2's approved seller/contact, inclusive MXN total, conditions, mandatory remedies and invoice-request route. Match public offer, order, payment and receipt; do not infer an added consumer charge from ACTV's $15 commission. Confirm actual provider/device PCI scope separately from Mexican law and any financial-licensing perimeter. Sale ticket/Stripe receipt is not automatically CFDI; the existing accountant/provider can handle that duty if evidenced. No wallet, custody, tax engine or automatic subscription feature is assumed.

Targets: components/CajaCobros.tsx; components/ConciliacionCobros.tsx; components/AdminPayments.tsx; app/_pagos/api.ts; app/registro/estado/*; supabase/functions/*; shared SQL order/access/recovery functions.
Exit gate: no unpaid/duplicate new folios, no oversell, safe same-order retries, server-recoverable counter sales and correct refunds/eligibility. Physical-card acceptance remains open until tested on the actual device.

### W4 — UNIFY RECEIPTS AND QUALIFY THE STAFF STATION
Owner: engineering plus an on-site ACTV tester.
Dependencies: W3 receipt/recovery contract; W0 device inspection. Template work may run alongside W2/W3.

Work:
  1. Extract one SALE receipt renderer for Caja, Reportes and ListaAtletas. Package logo/assets so printing does not depend on a WordPress image request.
  2. Preserve 58 mm customer/organizer copies and same-folio reprint. Use the installed Android print route first; introduce a thin adapter only if qualification shows it is necessary. A returned `window.print()` call or closed dialog does not prove paper output; when reliable completion is unavailable, show that printing was requested but remains unconfirmed and offer the same issued receipt again.
  3. Keep quotations semantically separate: their letter/58 mm documents are not confirmed-paid sale receipts. Share print control/layout primitives/assets where useful, not payment/folio gates.
  4. Keep kit rear-camera capture and authorized attendance. Preserve manual event-scoped folio lookup. A new QR scanner is an enhancement unless W0 proves it is a required current workflow; if added, resolve an event-aware registration and enforce backend access.
  5. Give tablets an operations launch/shortcut within the same app and test lock/reopen, orientation and reconnection. Detect or reject stale pre-cutover application writes.
  6. Close G1/G2/G6 using the existing Storage/kit path: authorized evidence access, handoff actor/time, approved expiry, supported object deletion and observable cleanup retries. Resolve uncertain commits before compensation; remove only proven unreferenced objects after the agreed grace period. Preserve the existing zero-row guard. Qualify access/URL changes with the replacement viewer before the coordinated switch, so the live old viewer is not broken early.
  7. Use online-required pause/original-record recovery as the baseline; any required continued offline handover needs an explicitly qualified controlled fallback. Rehearse same-person competition, proxy/partial-group pickup, interrupted handover, no-code lookup, wrong-event code and audited correction. Record physical arrival/service targets and test a novice/shift change on available equipment, with exceptions routed to the lead.

Targets: components/TabCaja.tsx; components/TabReportes.tsx; components/TabListaAtletas.tsx; components/TabCotizaciones.tsx; components/TabEntregaKits.tsx; public/manifest.json; public/sw.js; new shared receipt/print modules.
Exit gate: actual tablet produces readable copies and scannable intended QR; paper-out/disconnect/reprint never creates another sale; camera and kit/attendance work; required quotation formats still print. Record the qualified Android/browser/print-service/printer/card versions and settings for later maintenance. Browser screenshots alone cannot pass this gate.

### W5 — BUILD THE COHERENT REPLACEMENT EXPERIENCE
Owner: engineering; ACTV users validate task completion.
Dependencies: W2 contracts; W3 recovery; W4 device-ready components.

Work:
  1. Public race homepage and guest purchase remain one journey; account activation is optional afterward.
  2. Mi ACTV emphasizes the next race/folio, then a plain attended-race history. Use typography/spacing, restrained accent color and clean rows; do not reuse the card-heavy dashboard as the design baseline.
  3. Combine organizer/staff work into one event operations workspace. Show actions by permission, not separate overlapping dashboards.
  4. Retain required current operations: athlete intake/search, groups/relays, receipts/reprints/WhatsApp, kits/photos, events, clubs, users/assignments, reports, clients/services and quotations. Keep secondary administration out of the main runner navigation.
  5. Replace per-screen business rules with the shared service contract and paginated/event-scoped reads; remove the root page's initial 50,000-row loading pattern.
  6. Map old entry links/bookmarks/PWA starts to the correct new area. Keep existing store checkout and historical store account links intact without building a second store.

Targets: app/page.tsx; app/inicio/*; app/carreras/*; app/mi-actv/*; app/organizadores/*; components/Tab*.tsx; shared navigation/service modules; legacy-route redirects.
Exit gate: every retained capability has a tested replacement path and no permanent old-POS link; visitors, runners and staff can complete their main tasks without navigating unrelated modules. Test routine sales, original-order recovery, reprints, kits and attendance with the appropriate roles: each operator completes their assigned tasks without SQL, CLI or a developer, and without broader permissions.

### W6 — PROVE THE COMPLETE RELEASE IN STAGING
Owner: engineering runs automated suites; ACTV operator/finance validates real equipment and operations.
Dependencies: W0–W5 complete at one frozen revision.

Use the W1 checklist/evidence index for this exact revision. Automated checks verify persisted outcomes, not only screen text or an agent's approval. Real equipment and operational acceptance remain explicit human evidence. Fix a failure in a small reviewed change and rerun affected checks plus the mandatory regression suite; do not edit acceptance criteria to turn a failure into a pass.

Required tests:
- Execute G1–G8, F1–F5 and L1/L2 pre-cutover scenarios in the single readiness record. All scenarios default to W6 except explicitly W7-tagged actual production acceptance, which stays NOT_RUN until the authorized switch. Attach candidate/configuration/environment-bound outcomes to the existing evidence index; required scenarios remain NOT_RUN until proved. Reuse local Stripe/international/3DS/recovery proofs as regressions, without calling them hosted/device qualification. Recover the modeled 300 orders/minute across overlapping launches as an initial load hypothesis to validate, not measured demand or a passed hosted purchase result.
- Full role matrix: anonymous access denied where required; own/other runner; own/other organizer event; assigned/unassigned cashier; manager; revoke/offboard; partial provisioning failures.
- Existing records: pre-cutover folios/IDs, valid capacity, unknown legacy money state, kit obligations and authorized lookup; no invented captures or account ownership.
- Individual/group/relay checkout online, cash and supported reader; actual staff receipt; optional account activation; physical/companion linking; kit/attendance; correct runner history.
- Failure injection: duplicate/out-of-order/missed payment notices, late capture, declines, browser/response loss, tablet restart, original-attempt recovery, full/partial refund, printer failure and reprint.
- Two tablets competing for the final spots and one shared folio sequence.
- Closed creation gate: direct fresh/stale-client requests cannot create guest or staff cash/card orders or new attempts; accepted pending payments still settle/recover correctly, and lookup/reprint remains authorized and available. Reopening is an explicit authorized operation.
- Hosted load: 1,500 synthetic purchases across overlapping races while counter operations remain active, with duplicate notifications. Include representative accumulated data and supported configuration shapes, then measure a hot event alongside other events/staff lookup. Zero unpaid/duplicate folios and zero oversell. Real provider sandbox transactions are separate from fixture volume so provider limits do not invalidate the workload.
- Full staff parity: clubs/users/assignments/reports/quotation documents and WhatsApp actions, as well as core race flows.
- L1/L2 legal/operational acceptance: approved notices at actual collection points; separate optional sharing/revocation; identity-checked ARCO exercise within applicable business-day clocks; deletion/blocking/retention exceptions and restore; access and incident/notification drill; truthful total, statutory cancellation/refund and receipt/CFDI route; actual vendor/funds/provider approvals and conditional-minors determination. Reuse existing access/payment tests. A policy document alone cannot pass a technical check; an ordinary technical test cannot establish legal applicability.
- Rehearse the exact supported migrations with representative old data, a competing lock and accepted pending payments/callbacks. Record lock/statement/deployment budgets and a bounded failure/partial-application recovery path. Measure actual burst arrivals, failures, lock/pool pressure and backlog drain; request idempotency alone does not resolve a fresh second purchase after an uncertain first result.
- Release rehearsal: app/schema/functions/config/jobs match; stale tablet cannot use retired writes; existing-store smoke test passes; database and kit-evidence restore is demonstrated with measured recovery time and a recorded recovery point. Demonstrate reconstruction/reconciliation of accepted cash orders, receipts and shift records after that point using trustworthy retained evidence and original order/folio identities. Provider replay alone cannot pass cash recovery. Verify provider/card obligations separately.

Existing local/CI fixture passes are reusable regression evidence, not a substitute for the complete hosted/equipment tests. Measure backend checkout and capture-to-folio timings separately from page delivery, and set engineering acceptance thresholds before the run.

Evaluate successive W2–W5 changes with the readiness record's six-ID focused sequence: synthetic initial state, approved policy, actor/actions/failures and exact persisted outcomes. Require new behavior plus applicable earlier passing contracts; review the diff for duplicate business authorities and unnecessary coupling. This adapts SlopCodeBench, SWE-bench Pro and OpenEnv tau2 methods without running those frameworks or replacing physical acceptance. It does not waive any required W6 scenario. Include shared-printer contention in the field burst and inject failed background work while pages appear healthy; HTTP 200 cannot serve as the outcome assertion.

Before this rehearsal, prepare one concise operations runbook, reusing existing health/recovery tools. Name the primary service owner, backup, coverage and acknowledgement/escalation times. Record numeric thresholds/windows and responses for checkout availability, capture-to-folio delay, orders in review, stale/failed recovery, repeated callback failures and refund/payout exceptions. A stalled health job must be detected by an independent availability/heartbeat check. Test delivery to the responder and escalation, not just a health query or successful cron enqueue. Unpaid/duplicate issuance, oversell and unauthorized access are release-blocking correctness failures. Rehearse pausing affected new sales while retaining lookup, callbacks and reconciliation for accepted/pending orders.

Coordinate with the separate "Plan product maintenance dashboard" chat (01a205d3-fb98-7430-8b60-8e67d376e7e6). Its product-maintenance-scope.json now records an ACTV proposal against older main 45c6962; provisional pilot wording does not override this whole-release/cutover plan. ACTV supplies authenticated aggregate counts/ages for money/review/refund exceptions, recovery/cleanup freshness and release identity, without participant details or privileged credentials. HTTP 200 or cron enqueue alone cannot establish health. The dashboard can propose/run updates through ACTV's verification, staging and release policy, without bypassing money/access/schema review or directly changing the ledger. Reuse delivery when tested; otherwise prove alerts through a working existing route. Dashboard completion and a new paid resource are not assumed launch dependencies.

Exit gate: no unresolved failure involving money, folio/capacity, permissions, active pre-cutover registrations, required staff capability, physical operation or recovery. The owner accepts the documented recovery-point window and measured recovery time, and the rehearsal accounts for every accepted cash/provider order without inventing IDs or captures. Missing backup capability/cost is resolved before scheduling production. Lower-impact findings must have an owner and an explicit disposition. The evidence index passes; alert delivery/escalation and the maintenance handover below pass. Engineering and the ACTV operator approve the exact recorded release before scheduling the switch.

### W7 — COORDINATED TOTAL CUTOVER
Owner: engineering executes the rehearsed release; ACTV operations owns the sales pause/reopen and exception resolution.
Dependencies: W6 passes; exact release/configuration and recovery route recorded.

Sequence:
  1. Schedule the maintenance window and define go/no-go owners. Refresh reconciliation counts immediately before cutover; 900 is the November 22 snapshot, not a fixed launch total.
  2. Pause all old race-sale/issuance paths and keep the replacement's server creation gate closed. Resolve or explicitly own pending payments, charged-without-folio cases, valid outstanding entries/kits and refunds. Do not disable a callback while an earlier payment can still settle without a designated recovery owner.
  3. Take verified recoverable application/database/Storage backups and preserve old operational evidence. Do not import external history as a hidden task. If essential active obligations exist only in external systems, settle them before cutoff or obtain an explicitly scoped transition decision.
  4. Stop old writers, apply the rehearsed compatible schema/permissions and deploy the matching functions/app/configuration with new creation still blocked. Move public race links and tablet shortcuts to the replacement. Keep merchandise-store paths/functions intact.
  5. With the gate closed, reconcile existing registration IDs/folios and capacity; verify versions, access, receipt/reprint, kit/attendance, account lookup and recovery readiness without new sales. Prove direct old/new creation requests are blocked; retain accepted-order lookup, callbacks and reconciliation.
  6. Verify old issuers are stopped, then authorize opening the replacement creation gate once. Shut the old race/POS application and obsolete race-specific issuers down without abandoning pending obligations. Perform the authorized controlled cash/online/card checks and reconcile them; from the first new order/attempt onward, use the recovery rule below. If checks fail, close new creation and preserve/reconcile accepted transactions. Do not leave a second allocator behind a stale tab, old URL or background job.
  7. Reconcile the first live orders and shift close through the single new ledger and retain an accountable support/recovery owner.

Maintenance handover (prepare before W6, continue after cutover): the named maintainer reviews dependency/runtime/provider support and updates monthly, records urgent security/payment/provider notice triage and mitigation targets under the agreed coverage, and sends changes through the same verification and staging path. Recheck receipt/QR/reconnect and counter flows after relevant Android/browser/print-service updates. Rehearse database, kit-evidence and cash/provider recovery at least quarterly and after relevant financial/schema/recovery changes. Keep pending financial exceptions owned until resolved. Maintain one operations runbook with supported versions, update cadence, alert/incident steps, release/recovery artifact references and the station compatibility record; update it with related code/configuration changes. Reuse current tooling, with no new monitoring platform or extra service assumed.

Privacy/consumer handover: keep the named rights/incident contacts and approved notices, retention/processor records and invoice/refund responsibilities current. Review legal applicability when laws or collection/sharing/funds/subscription features change. Incidents are assessed without waiting for proof that someone downloaded a photo; notification follows the applicable Mexican rule, not an assumed GDPR clock. Retain only required evidence under the approved schedule; do not restore expired data into active use or keep every photo forever.

Before ANY new order or provider attempt exists: use the rehearsed compatible rollback during maintenance if go/no-go fails.
After ANY new order/attempt exists: pause sales, preserve accepted/pending transactions and reconcile provider status; use the tested compatible rollback/fix-forward procedure. Even a pending checkout can still settle, so no-capture-yet does not make snapshot restoration safe. Reconstruct and reconcile recorded cash separately as well. Do not restore an old database snapshot blindly and discard new obligations.

## Evidence and decision gates

Verified current baseline: old July production app has no source SHA established; production Supabase has nine public operational tables, no new actv_payments schema or deployed payment Edge Functions. Current/future registration counts were checked read-only on November 22. The new local code contains the payment and portal implementations, but it is not a complete deployed replacement.

Must be discovered by the team: actual tablet runtime/print service, card provider/API compatibility, required exact current staff behavior, old race issuer/URL ownership, isolated staging access, hosted email/provider configuration and authorized treatment of old active records. These are W0/W2/W3 tasks, not questions the user must answer from memory.

No date or cost estimate is committed before the W0 inventory resolves those dependencies. No production change, resource purchase or live charge is authorized by creating this plan.

## Completion definition

Complete means the replacement covers the agreed capability matrix; existing operational records and valid folios still work; every new sales channel uses the one ledger; real tablets/printers/card equipment pass; permissions and recovery pass; the store remains unchanged; the coordinated cutover is accepted; and the old race/POS application and old issuers are off. Shared contracts have owners, release checks enforce the evidence, and the tested maintenance/alert/recovery handover has a primary and backup owner. A new homepage, a green build or a browser-only demo is not completion.

## Independent review

Three independent planning reviews covered data/application contracts, hardware/staff operations and red-team release/cutover/recovery. Their corrections are incorporated: keep the tested financial core; preserve existing operational records in place; complete real permission provisioning; recover sales from the server; qualify physical devices; coordinate every issuer at cutover; and prove cash as well as provider and kit-evidence recovery. Review of the plan is not approval to deploy. No source application or production implementation has been changed by this planning work.

Revision 4 review: benchmark refinements passed narrow source/scope review; a dedicated Mexican regulatory review and independent official-source challenge informed L1/L2. Both final consolidated gate reviews confirmed the exact plan/readiness snapshots without a material correction or blocking contradiction. Discovery remains OPEN: 15 OPEN items, 29 NOT_RUN acceptance scenarios (28 W6 and one W7), readiness NOT_QUALIFIED. Benchmark execution was canceled; the resources remain evaluation-method references only. Neither document review nor policy approval establishes implemented controls, legal compliance, hardware qualification or production-release approval.

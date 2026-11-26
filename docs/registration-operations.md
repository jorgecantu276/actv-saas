# Registration snapshots and event operations

Source candidate 0.2.0-rc.4 builds on the private evidence, sale receipt and sales recovery baseline. The release remains unqualified for production until the existing W6/W7 gates pass.

## Registration facts

Migration 125 captures participant, shirt, package, price, event edition and configured document acceptance when an online, cash or terminal order is accepted. Physical sales read the athlete under a transaction lock at that point. Payment confirmation attaches the already accepted snapshot to the registration. Changing a profile or event afterwards cannot rewrite the accepted record, its receipt or its kit choices. Reusing a request preserves its original payload and snapshot even after a policy update.

The required-field policy always retains the existing five mandatory fields: name, surname, phone, emergency phone and shirt size. An active manager can explicitly configure additional fields and notice/participation document text with version identifiers. Guest and counter forms display the actual configured documents and record separate acknowledgements for each participant. Direct API requests enforce the same requirements and exact policy revision, including when text changes under the same version label. Refreshing documents clears prior acknowledgements. Storing a policy does not establish legal approval or a participant's personal account ownership; counter acceptance is attributed to the recording operator.

Legacy registrations are preserved, including valid folios without an athlete link. Unknown acceptance dates, document versions or missing facts remain unknown. Where historical accepted item data exists, it is retained as partial evidence; other effective values are explicitly observed at upgrade. These observations are frozen for operational continuity and never relabelled historical acceptance.

## Corrections

`actv_registration_record` provides current scoped facts, original acceptance and the correction history. Only an active manager can call `actv_correct_registration`; every correction needs a reason, request UUID and expected revision. Concurrent stale edits fail. A lost response can replay the same request and payload. The append-only audit retains actor, time, before/after and applied revision.

Allowed corrections address participant name/contact, birth date, gender, city, club or shirt choice for this registration. They preserve original values and cannot transfer athlete/account ownership or change event, package, price, payment, folio or consent. Unknown legacy fields need not be invented to correct another known field. Corrections do not alter the reusable athlete profile. Receipts, kit lists and workspace rosters use the effective snapshot; corrected receipts explicitly show the revision.

## One event operations workspace

`/operaciones` is the shared staff/organizer entry. The old root entry redirects there; organizer signup and payment-account setup remain available and lead to the same event workspace. The server derives capabilities from current staff authority and organizer memberships. Membership alone never grants cashier, manager or correction authority.

Select an event, then use the authorized registration/attendance, sale recovery, kit, report or settings actions. Registration search and pagination run on the server within the event scope. Global retained administration is loaded on demand through its appropriate permissions; there is no root 50,000-athlete preload. Permission failures clear data and remain visible. Existing merchandise-store destinations remain unchanged.

Event settings use one authorized event/configuration contract with an explicit test/live choice and payment readiness checks. Existing obligations prevent unsafe identity/date/mode changes or reducing capacity below committed use. A permitted environment change invalidates the old reader configuration. Pausing new sales uses the existing sales gate/publication controls and preserves accepted-payment callbacks and reconciliation.

## Verification and deployment boundary

The existing `npm run verify` adds actual Auth/PostgREST snapshot/correction, workspace and bounded club contracts to the full Supabase stage, retaining financial, evidence, receipt and staff regressions. The API schema readiness barrier waits for the new RPC inventory after asynchronous PostgREST reload; it never retries a failed write or accepts a missing RPC as authorization denial. Clean and retained-data adoption must reach the same schema and keep original identifiers/folios.

The browser contract launches an owned headless Chromium profile and isolated Next development output against the same disposable local Supabase services. It exercises real authentication and workspace actions, retains synthetic desktop/tablet screenshots and records its browser version. External application/provider requests are blocked; the font loader uses an explicitly recorded local test fallback. Private temporary files and app processes are removed. This UI evidence supplements the production build and database contracts; it does not establish Android/printer/provider qualification.

Deploy matching migrations, functions and app only through the approved staging/release procedure. Old direct event writers are retired by the new contract. Hosted mode/account/reader configuration, approved fields/documents/correction procedures, all retained operator tasks, actual equipment, privacy/consumer decisions, recovery/alerts and the coordinated cutover still need their own evidence. No production deployment, charge or print is authorized by candidate verification.

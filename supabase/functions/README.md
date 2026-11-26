# ACTV Stripe pilot operations

The Edge Functions use the same ACTV Postgres accounting model for hosted Checkout and an eligible
connected-account Terminal reader. Checkout uses Stripe Standard accounts and hosted links, then makes direct
MXN card charges on the connected account. Stripe Terminal creates direct MXN `card_present` PaymentIntents
with automatic capture. Reader hardware, sandbox and live activation are separate verification steps. The
integration has no route that fabricates payment confirmation.

## Staging setup

Use a separate Supabase project with synthetic data and a Stripe sandbox. Once the staging ACTV baseline
schema is in place, apply every pending migration for the deployed revision, including shared schema changes
used by Stripe and Mercado Pago. For the hosted online Stripe pilot, deploy `actv-checkout`,
`actv-organizer-connect`, `actv-stripe-webhook` and `actv-stripe-reconcile`. Deploy `actv-admin-payments`
for the `/pagos` checks and `actv-stripe-terminal` for in-person payments. For a Stripe-only staging event, keep
`mercadopago_enabled=false`. Its `ACTV_MP_TEST_*` settings and `actv-mercadopago-webhook` are only needed
for the separate Mercado Pago test.

Set these values through Supabase Edge secret management. Put local-only values in an ignored env file.
Keep Stripe secrets, webhook signing secrets, and privileged Supabase keys on the server.

| Variable                       | Value                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTV_STRIPE_MODE`             | `test` for Stripe sandbox, `live` only on the approved production setup                                                                                                                   |
| `ACTV_STRIPE_SECRET_KEY`       | Platform Stripe API secret scoped to the configured mode, with Connect account/link, Checkout, PaymentIntent, refund read/write for the admin panel, dispute read, payout/balance read, and opted-in Terminal permissions |
| `ACTV_STRIPE_WEBHOOK_SECRET`   | Signing secret for this exact Connect event destination in the configured mode                                                                                                            |
| `ACTV_STRIPE_RECONCILE_SECRET` | Unique unpredictable worker secret of at least 32 characters                                                                                                                              |
| `ACTV_APP_URL`                 | `https://staging-pdv.actv.mx` for hosted staging. `http://localhost:3000` is supported for a local test |
| `ACTV_STAFF_ORIGIN`            | Optional separate HTTPS origin for the cashier site when it differs from `ACTV_APP_URL`                                                                                                   |

The Supabase runtime provides `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (default `secret` key) or the legacy
`SUPABASE_SERVICE_ROLE_KEY`. `supabase/config.toml` configures the Edge gateway. The organizer, admin and
terminal handlers verify the Supabase user token and the database checks scoped assignments. The public
checkout requires both order UUID and opaque status token for status/resume. The status token travels in the
return URL fragment. Use the same Stripe sandbox for the platform key, connected Mexican Standard account and
webhook destination.

Use the Stripe Connect destination for **events on connected accounts**, snapshot format, for
`actv-stripe-webhook`. Subscribe to the set enumerated in `_shared/stripe-events.ts`. Stripe’s endpoint path
is `/functions/v1/actv-stripe-webhook`. Keep legacy JWT relay verification disabled for this specific
function. The function verifies the exact signed body and rejects a bad signature before any database access.
It stores minimal IDs and type, fetches the current provider object scoped to the signed account, and only
confirms an already attached ACTV Checkout session or Terminal PaymentIntent. Install and verify the test
destination before exposing a published event.

Schedule a single invocation each minute of `POST /functions/v1/actv-stripe-reconcile`,
`Content-Type: application/json`, `x-actv-reconcile-secret: <secret>` with `{"limit":10}`. Store the header
value in a secrets manager or Supabase Vault for a reviewed scheduler integration. The worker is privileged
and is independent of the public status poll. Alert on failed HTTP responses, failed records or oldest
unprocessed event age. Rows keep provider event IDs and sanitized failure codes for replay triage. The worker
claims due provider events one at a time, up to the requested limit. A claim reserves the event for eight
minutes while its worker is active. If that worker stops before finishing, a later run can claim the event
after the lease expires. Acknowledgments from an expired lease cannot change the event. A successful direct
Stripe delivery can still complete it immediately. Provider failures keep an exponential retry delay of
15 seconds to one hour. The worker also checks pending orders with attached IDs and recovers eligible admin
refund records using read-only Stripe lookups.
Provision the scheduler explicitly in staging and production. This repository does not install credentials, a
hosted event destination, or a cron schedule by itself.

## Payment paths and verification

- `actv-admin-payments`: the payments manager can list and inspect local orders, see Stripe charge details, and issue a full refund against an eligible card payment. The request records the manager, reason, commission choice, and Stripe refund ID. Use Stripe for partial refunds and reconciliation exceptions.
- `actv-checkout`: `event` resolves a published UUID or slug, `start` opens one hosted Checkout session using
  the recorded order amount, `status` reads database state, and `resume` retrieves the same still-open session
  for that order token. Checkout and onboarding use Stripe's canonical HTTPS hosts during the pilot.
- `actv-organizer-connect`: authenticated `onboard` creates or reuses a Standard account and creates a fresh
  Stripe-hosted link. `status` checks Stripe-side charges/payouts configuration. Returning from onboarding
  does not enable an event automatically. Publication is a separate authenticated action in the organizer
  area.
- `actv-stripe-terminal`: authenticated `start`, `status`, `retry`, and `cancel`. The reader comes from the
  configured event and the connected account, never a browser-supplied reader ID. Test on a Stripe simulated
  reader in an eligible `MX` location, then separately on the actual approved device. With collection
  underway, cancel on the reader first and then repeat the app cancellation. When card payment is uncertain,
  check the same PaymentIntent before taking another tender.
- `actv-stripe-webhook` plus reconciler: use the same state-sync logic. Checkout requires a paid/complete
  session with an associated succeeded PaymentIntent and a captured Charge of the exact currency and amount.
  Terminal requires the corresponding succeeded `card_present` intent and captured Charge. Eligibility
  reflects known reversals. On automatic payouts, `payout.reconciliation_completed` triggers payout
  balance-line capture. Payout state, gross, fee, net and Stripe references support matching to a bank
  statement. Stripe payout `paid` alone does not match a bank deposit. Manual payouts require a separate
  statement workflow.

Stripe sandbox purchases and the local regression tests used the local ACTV backend. Hosted staging still
needs the checkout, Connect webhook and scheduled reconciliation verified together. For a MXN 350 online
purchase, compare the captured charge on the organizer account, one eligible folio in ACTV, and the matching
MXN 15 [Application Fee](https://docs.stripe.com/api/application_fees) on the platform sandbox. Resend the same
event and check that the counts stay at one. Test failed and abandoned payments, out-of-order success and
expiry, interrupted delivery followed by scheduled recovery, and refunds. Test Terminal and payout exports
separately if those features are in scope. The offline commands below exercise synthetic Stripe responses and
fixture signatures.

```sh
deno test --allow-env --config supabase/functions/deno.json supabase/functions/_shared/payments_test.ts
deno lint --config supabase/functions/deno.json supabase/functions
```

[Stripe Standard onboarding](https://docs.stripe.com/connect/standard-accounts) ·
[Direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted) ·
[Connected account webhooks](https://docs.stripe.com/connect/webhooks) ·
[Server-driven Terminal](https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven)
· [Balance transactions and automatic payouts](https://docs.stripe.com/api/balance_transactions/list) ·
[Edge Functions and Stripe webhook signatures](https://supabase.com/docs/guides/functions/examples/stripe-webhooks)

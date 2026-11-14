# ACTV Stripe pilot operations

The five Edge Functions use the same ACTV Postgres accounting model for hosted Checkout and an eligible
connected-account Terminal reader. Checkout uses Stripe Standard accounts and hosted links, then makes direct
MXN card charges on the connected account. Stripe Terminal creates direct MXN `card_present` PaymentIntents
with automatic capture. Reader hardware, sandbox and live activation are separate verification steps. The
integration has no route that fabricates payment confirmation.

## Staging setup

Use a separate Supabase project with isolated synthetic data and a Stripe sandbox. Apply the ACTV accounting
migrations to the staging project once its baseline ACTV schema matches the references in the migrations. Set
the following environment values using Supabase Edge secret management. Put local-only values in an ignored
env file. Never place any Stripe secret, webhook secret or Supabase privileged key in a `NEXT_PUBLIC_`
variable, browser bundle, Git history, or URL.

| Variable                       | Value                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTV_STRIPE_MODE`             | `test` for Stripe sandbox, `live` only on the approved production setup                                                                                                                   |
| `ACTV_STRIPE_SECRET_KEY`       | Platform Stripe API secret scoped to the configured mode, with Connect account/link, Checkout, PaymentIntent, refund/dispute read, payout/balance read, and opted-in Terminal permissions |
| `ACTV_STRIPE_WEBHOOK_SECRET`   | Signing secret for this exact Connect event destination in the configured mode                                                                                                            |
| `ACTV_STRIPE_RECONCILE_SECRET` | Unique unpredictable worker secret of at least 32 characters                                                                                                                              |
| `ACTV_APP_URL`                 | Checkout and organizer site HTTPS origin, without a path. `http://localhost:3000` is supported in test mode                                                                               |
| `ACTV_STAFF_ORIGIN`            | Optional separate HTTPS origin for the cashier site when it differs from `ACTV_APP_URL`                                                                                                   |

The Supabase runtime provides `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (default `secret` key) or the legacy
`SUPABASE_SERVICE_ROLE_KEY`. The organizer and terminal functions verify the Supabase user token and the
database checks scoped staff or manager assignments. The public checkout requires both order UUID and opaque
status token for status/resume. The status token travels in the return URL fragment. Separate staging and
production database, merchant accounts, web origins, credentials and webhook destinations. Do not switch an
active production environment to test mode for a trial.

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
selects pending events with backoff and orders with attached IDs, and avoids unbounded orders per invocation.
Provision the scheduler explicitly in staging and production. This repository does not install credentials, a
hosted event destination, or a cron schedule by itself.

## Payment paths and verification

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

In staging, test authorized and failed payments, replay of one Stripe event, out-of-order success/expiry,
interrupted webhook delivery followed by scheduled recovery, terminal decline/retry/cancel, expired
reservation with late capture, refunds/disputes, and an automatic-payout export against a sample statement.
Confirm a failed or merely authorized payment produces zero folios and retries never mint a second folio. Use
Stripe sandbox payment methods and a simulated reader. The offline tests below exercise synthetic HTTP
responses and cryptographic fixture signatures without network access or live secrets.

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

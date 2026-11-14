# ACTV payment pilot

The app remains on Hostinger. Supabase Auth, Postgres and Edge Functions handle the payment workflow. Test against a dedicated Supabase project and Stripe sandbox before updating `pdv.actv.mx`.

## What the pilot covers

- Organizers use `/organizadores?evento=<uuid>` to open Stripe-hosted onboarding for their own Mexican Standard account. Once that account is ready, the event can be published at `/carreras/<slug>`. The public starter sends MXN card customers to Stripe-hosted Checkout using prices pinned by Postgres.
- One database transaction links a verified, captured Stripe payment or an authenticated cashier's explicit cash receipt to the folio. It locks the event, checks remaining capacity and issues once. A retry uses the same order. Captured payments whose stock expired or whose folios became ineligible remain visible for review. Pending orders never return folios.
- Stripe Terminal supports an eligible online server-driven Stripe reader assigned in the organizer's Stripe account. Caja can wait, retry the same payment or reconcile its authoritative status. The existing reader's manufacturer and acquiring account must be verified before replacing its workflow.
- Reports shows captures/refunds/disputes by channel, cash close and deposit variance, Stripe automatic-payout lines and bank matches, failed webhook backlog, and outstanding order exceptions. Stripe manual payouts require statement matching outside the automatic itemized path. POS cash close covers opening float, sale receipts and counts. Till drops, paid-ins and cash refunds need a documented exception process for the pilot.
- Prior registrations remain marked historical. The unreliable direct WordPress CSV write is removed. Preserve and reconcile the old WooCommerce and processor records separately. Route only the pilot's new orders through ACTV; suppress old issuance for that routing path to avoid assigning two folios.

## Provision a real staging checkout

1. Create or select a **dedicated** Supabase staging project and a **distinct** Hostinger staging Node site with synthetic data. Stage the existing ACTV Auth and public schema first using a **schema-only** baseline. The migrations reference the existing `eventos`, `atletas`, `perfiles` and `inscripciones` tables. Verify the baseline also provides other PDV tables, Auth trigger and Storage if exercising the full staff app. The local test stub is intentionally limited to the ledger's dependencies.
2. Link the CLI to the staging project. Check `supabase migration list` and `supabase db push --dry-run`, then apply the four migrations. They are previewed by the local harness. Provide the staging project's URL, publishable/anon key and server-only service role key in the Hostinger app's build/runtime settings. The service role key supports staff login-management server actions and must stay server-side. Build the worktree using `npm ci` and `npm run build`, then use the separately named Hostinger staging domain as the CLI deploy target. Use its explicit staging app origin for Edge settings.
3. Provision an Auth user and matching profile, then assign the reviewed users in the ledger. Existing profile-role text does not authorize money operations. Use the SQL below as a parameterized template with actual **staging** IDs. The first manager should also have the `Administrador` profile label to expose the admin navigation. Set cashier scopes narrowly, and give the organizer membership only in their organizer record.

   ```sql
   insert into actv_payments.staff(user_id,role,all_events)
   values ('<manager-profile-uuid>','manager',true), ('<cashier-profile-uuid>','cashier',false);
   insert into actv_payments.staff_events(user_id,event_id)
   values ('<cashier-profile-uuid>','<event-uuid>');

   insert into actv_payments.organizers(id,name)
   values ('<organizer-uuid>','Staging organizer');
   insert into actv_payments.members(organizer_id,user_id)
   values ('<organizer-uuid>','<organizer-profile-uuid>');
   insert into actv_payments.events(event_id,organizer_id,live_mode)
   values ('<event-uuid>','<organizer-uuid>',false);
   ```

   Set managers, cashiers, event assignments and organizers independently for production. Remove access from the payment staff and organizer membership tables during offboarding before removing app access. Set the pilot organizer assignment before starting sales. If staging orders already exist, create a clean event for reassigning and testing a different merchant.

4. Follow [Stripe operations](../supabase/functions/README.md) to configure sandbox Edge secrets. Deploy each of the five named functions with the staging project ref. Create the **connected accounts** snapshot webhook destination in Stripe sandbox, then sync the matching `ACTV_STRIPE_WEBHOOK_SECRET` and verify signed delivery logs. Turn on the [scheduler script](../supabase/operations/schedule-reconciliation.sql) after creating its two dedicated Vault entries. The organizer and reader handlers validate the user via Supabase Auth before their RPCs. The webhook and worker verify their own signatures and secrets.
5. Open the organizer URL, finish hosted onboarding and explicitly publish the staging event. Check success, failed authorization, duplicate and reordered webhooks, an outage followed by recovery, and refunds. Use a simulated Stripe reader in sandbox, then repeat on the actual approved terminal. Enter the reader ID with the authorized `actv_configure_event` RPC or the reviewed event row before the terminal test. Reconcile the payment, payout and bank reference, and compare the cash count against a known drawer. Capture evidence of every result before the first live pilot sale.
6. Run the 1,500-buyer fixture workload first on separate staging data. Use the fixture adapter for volume so it cannot affect Stripe rate limits or a live reader. Verify three overlapping launches against the hosted **staging** stack once that environment and its rate limits are available. For rollout, update only one event's purchase link at a time. Keep WooCommerce and its reconciliation available for existing orders.

## Repeat the local staging test

Start a fresh disposable Postgres cluster listening on `127.0.0.1:55432` and create `actv_payment_staging`. Do not point the harness at an existing environment. It creates test roles and the synthetic schema and requires a clean database. Use Node plus Deno with npm access to install dependencies.

```sh
npm ci
npm run test:payments:staging
deno run --allow-env --allow-net=127.0.0.1:55432 --config supabase/functions/deno.json --no-check tests/staging-edge.ts
deno test --allow-env --config supabase/functions/deno.json supabase/functions/_shared/payments_test.ts
npm run build
```

Use staging Supabase environment variables or explicit placeholders for the Next build. The first test drives database functions and adversarial timing cases. The second drives the actual Edge Checkout, status and signed webhook handlers with the real local database and synthetic Stripe HTTP responses. It cannot contact Stripe. The Deno suite covers signatures, account/intent binding, stale and modified payloads, advance refunds and Terminal behavior. These are local regression checks. Latency excludes WAN, Stripe, hosted Edge runtime, production database and the buyer's device.

## Stop or recover safely

If new online orders need to stop, disable the pilot event for new Checkout and keep the webhook, worker, order-status page and ledger running for existing charges. Do not route a buyer to a different checkout while their prior attempt is unresolved. For a cash timeout, recover the same sale in Caja and verify the ledger before taking cash again. For a definitively failed or expired recording after tender was physically taken, return or separately record the cash under manager supervision. Maintain an exception reference. For Terminal, check the original intent and the reader; a pending or uncertain card sale must not be collected by another tender as a second sale. Before resuming after a restore, compare provider captures and cash close records against folio issuance.

[Supabase CLI migrations](https://supabase.com/docs/guides/local-development/database-migrations) · [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks) · [Stripe sandbox](https://docs.stripe.com/test-mode)

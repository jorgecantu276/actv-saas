# ACTV payment pilot

> Plan vigente: [sustitución total de ACTV](implementation-plan.md). Este documento es una referencia técnica de pruebas/operación de pagos; no autoriza un piloto de enlace aislado ni un despliegue de esquema mientras el emisor antiguo sigue activo. El cambio requiere la versión y aceptación completas del plan.

> Alcance vigente: [ACTV, 21 de noviembre de 2026](project-scope.md). La entrega incluye registro, pagos, operación y pasaporte de asistencia. Tienda, resultados externos y migración del sitio anterior requieren cotización adicional. Las referencias históricas a esos trabajos no son requisitos de lanzamiento.

The app remains on Hostinger. Supabase Auth, Postgres and Edge Functions handle the payment workflow. Test against a dedicated Supabase project and Stripe sandbox before updating `pdv.actv.mx`.

## What the pilot covers

- Organizers use `/organizadores?evento=<uuid>` to open Stripe-hosted onboarding for their own Mexican Standard account. Once that account is ready, the event can be published at `/carreras/<slug>`. The public starter sends MXN card customers to Stripe-hosted Checkout using prices pinned by Postgres.
- One database transaction links a verified, captured Stripe payment or an authenticated cashier's explicit cash receipt to the folio. It locks the event, checks remaining capacity and issues once. A retry uses the same order. Captured payments whose stock expired or whose folios became ineligible remain visible for review. Pending orders never return folios.
- Stripe Terminal supports an eligible online server-driven Stripe reader assigned in the organizer's Stripe account. Caja can wait, retry the same payment or reconcile its authoritative status. The existing reader's manufacturer and acquiring account must be verified before replacing its workflow.
- Reports shows captures/refunds/disputes by channel, cash close and deposit variance, Stripe automatic-payout lines and bank matches, failed webhook backlog, and outstanding order exceptions. Stripe manual payouts require statement matching outside the automatic itemized path. POS cash close covers opening float, sale receipts and counts. Till drops, paid-ins and cash refunds need a documented exception process for the pilot.
- Prior registrations remain marked historical. The unreliable direct WordPress CSV write is removed. Preserve and reconcile the old WooCommerce and processor records separately. Route only the pilot's new orders through ACTV; suppress old issuance for that routing path to avoid assigning two folios.

## Provision the hosted Stripe sandbox checkout

The local checks and the Stripe sandbox purchases used the local ACTV backend. The hosted checkout remains to be verified. The staging site at `https://staging-pdv.actv.mx` responds, but the registration page still points to a placeholder Supabase URL. Use a dedicated Supabase staging project and deploy a fresh build to that staging hostname before testing an online sale there.

1. Create or select a **dedicated** Supabase staging project and a **distinct** Hostinger staging Node site with synthetic data. Stage the existing ACTV Auth and public schema first using a **schema-only** baseline. The migrations reference the existing `eventos`, `atletas`, `perfiles` and `inscripciones` tables. Verify the baseline also provides other PDV tables, Auth trigger and Storage if exercising the full staff app. The local test stub is intentionally limited to the ledger's dependencies.
2. Link the CLI to the staging project. Review `supabase migration list` and `supabase db push --dry-run`, then apply the pending migrations from `supabase/migrations/`. The local harness loads that directory in order. Apply the whole sequence for the chosen revision. The latest Stripe code also uses shared schema changes from the Mercado Pago migrations. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` in the Hostinger staging app. Run `npm ci` and `npm run build` against the chosen source revision, then deploy to the staging site. Set `ACTV_APP_URL=https://staging-pdv.actv.mx` on its Edge Functions.
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

4. Follow [Stripe operations](../supabase/functions/README.md) to configure the staging Edge secrets with `ACTV_STRIPE_MODE=test`. Deploy `actv-checkout`, `actv-organizer-connect`, `actv-stripe-webhook` and `actv-stripe-reconcile` to the staging project. Deploy `actv-admin-payments` for the `/pagos` checks. Keep `mercadopago_enabled=false` on the test event and leave the Mercado Pago environment variables unset. Create a **connected accounts** snapshot webhook destination in the same Stripe sandbox and set its matching `ACTV_STRIPE_WEBHOOK_SECRET`. Turn on the [reconciliation scheduler](../supabase/operations/schedule-reconciliation.sql) after creating its two Vault entries. Check that an invocation succeeds.
5. Set the synthetic event's price to MXN 350 and its `actv_payments.events.sandbox_fee_per_folio` to `1500` (MXN 15) while `live_mode=false`. Open the organizer page, complete onboarding for a Mexican Standard account in the same Stripe sandbox, check that charges and payouts are enabled, and explicitly publish the event. Buy one folio. Verify the MXN 350 captured charge on the organizer account, successful processing of the signed connected-account event, exactly one eligible ACTV folio, and a separate MXN 15 Application Fee linked to the same charge in the platform sandbox. Resend the same event and verify that both counts stay at one. Then repeat with Mexican, US and Canadian test cards in MXN, successful and abandoned 3D Secure, a declined card, late or reordered delivery, scheduled recovery, and refunds. Check that a failed or abandoned payment issues zero folios and that a two-folio MXN 700 sale produces two folios and one MXN 30 fee.
6. Run the 1,500-buyer fixture workload first on separate staging data. Use the fixture adapter for volume so it cannot affect Stripe rate limits or a live reader. Verify three overlapping launches against the hosted **staging** stack once that environment and its rate limits are available. For rollout, update only one event's purchase link at a time. Keep WooCommerce and its reconciliation available for existing orders.

If the pilot includes in-person payments, deploy `actv-stripe-terminal` to staging too. Assign a simulated reader in the organizer's eligible Mexican location through `actv_configure_event` or the reviewed event row. Test it before repeating on the approved physical reader. Reconcile payout and bank references and compare cash counts when those flows are in scope.

### Verify the runner and organizer sign-ups

In Supabase staging Auth, enable email sign-ups and configure the site's URL and permitted redirects. Allow the staging URLs for `/mi-actv` and `/organizadores`, including the organizer event return with its query parameters. Verify the signup and magic-link templates point to the intended staging host after confirmation. Use Mailpit for local tests and configure staging SMTP before inviting outside testers.

Open `/mi-actv` in a fresh browser session, choose **Crear cuenta**, open the delivered email and check **Mis folios**. After logging out, confirm that **Iniciar sesión** opens the same account. Repeat sign-up at `/organizadores` and create an organizer profile and a draft event with a $350 MXN folio. To show an **Abrir buzón de prueba** button during local development, set `NEXT_PUBLIC_ACTV_LOCAL_MAIL_URL` to the local Mailpit web URL when building. The button requires a loopback hostname for both the app and the mail UI.

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

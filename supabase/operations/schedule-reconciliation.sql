-- Run on the chosen Supabase staging project after deploying the Edge function.
-- First create these Vault entries in that same project:
-- actv_reconcile_url: https://<staging-ref>.supabase.co/functions/v1/actv-stripe-reconcile
-- actv_reconcile_secret: the exact ACTV_STRIPE_RECONCILE_SECRET from Edge secret storage
do $$
declare
  worker_url text;
  worker_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='actv_reconcile_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='actv_reconcile_secret';
  if worker_url is null or worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/actv-stripe-reconcile$'
    or worker_secret is null or length(worker_secret)<32 then
    raise exception 'Configure the ACTV reconciliation URL and dedicated worker secret in Vault first.';
  end if;
end $$;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'actv-payment-reconciliation', '* * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='actv_reconcile_url'),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-actv-reconcile-secret',(select decrypted_secret from vault.decrypted_secrets where name='actv_reconcile_secret')
      ),
      body := '{"limit":10}'::jsonb,
      timeout_milliseconds := 29500
    )
  $cron$
);

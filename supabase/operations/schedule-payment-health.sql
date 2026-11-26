-- Run as a database owner in the intended project after the health migration.
-- Choose false for sandbox / true for live and keep only its matching mode in this project.
-- Turn notifications on only after preparing the mode-specific secrets in Vault.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  monitored_live_mode constant boolean:=false;
  send_notifications constant boolean:=false;
  vault_prefix text:=case when monitored_live_mode then 'actv_health_live_' else 'actv_health_sandbox_' end;
begin
  if send_notifications and (
    not exists (
      select from vault.decrypted_secrets
      where name=vault_prefix||'webhook_url'
        and decrypted_secret ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^#[:space:]]*)?$'
    ) or not exists (
      select from vault.decrypted_secrets
      where name=vault_prefix||'webhook_token' and length(decrypted_secret)>=32
        and decrypted_secret !~ '[[:cntrl:][:space:]]'
    )
  ) then raise exception 'Configure the ACTV incident webhook URL and token in Vault first'; end if;

  if not send_notifications then
    update actv_payments.health_incidents set delivery_state='disabled'
      where delivery_state='pending';
  end if;

  perform cron.schedule('actv-payment-health-sample','* * * * *',
    format('select actv_payments.observe_payment_health(%L,%L);',
      monitored_live_mode,send_notifications));
  if send_notifications then
    perform cron.schedule('actv-payment-health-delivery','* * * * *',
      format('select actv_payments.deliver_payment_health(%L);',
        monitored_live_mode));
  elsif exists(select from cron.job where jobname='actv-payment-health-delivery' and username=current_user) then
    perform cron.unschedule('actv-payment-health-delivery');
  end if;
end $$;

commit;

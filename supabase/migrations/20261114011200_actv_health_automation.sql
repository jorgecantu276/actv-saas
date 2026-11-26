begin;

create table actv_payments.health_samples (
  live_mode boolean not null,
  observed_minute timestamptz not null,
  signals text[] not null,
  metrics jsonb not null,
  primary key (live_mode,observed_minute)
);

create table actv_payments.health_incidents (
  id uuid primary key default gen_random_uuid(),
  live_mode boolean not null,
  observed_at timestamptz not null,
  signals text[] not null,
  metrics jsonb not null,
  delivery_state text not null check (delivery_state in ('disabled','pending','sent','failed')),
  delivery_attempts integer not null default 0,
  delivery_after timestamptz not null default now(),
  net_request_id bigint,
  delivery_http_status integer
);
create index actv_health_delivery_queue on actv_payments.health_incidents(live_mode,observed_at,id)
  where delivery_state='pending';

create function actv_payments.observe_payment_health(p_live_mode boolean,p_notify boolean)
returns void language plpgsql set search_path='' as $$
declare
  v_now timestamptz:=now();
  v_minute timestamptz:=date_trunc('minute',v_now);
  v_health jsonb;
  v_previous text[];
  v_signals text[]:='{}';
  v_metrics jsonb;
  v_overdue bigint;
  v_missing_folios bigint;
  v_failed_payouts bigint;
  v_failing_refunds bigint;
  v_oldest_refund timestamptz;
begin
  if p_live_mode is null or p_notify is null then
    raise exception 'Explicit Stripe mode and notification setting required' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(17941002,p_live_mode::integer) then return; end if;
  select signals into v_previous from actv_payments.health_samples
    where live_mode=p_live_mode order by observed_minute desc limit 1;

  v_health:=actv_payments.payment_health(p_live_mode);
  v_overdue:=(v_health#>>'{webhooks,overdue}')::bigint;
  v_missing_folios:=(v_health#>>'{counts,captured_without_eligible_folios}')::bigint;
  v_failing_refunds:=(v_health#>>'{refund_recovery,failed}')::bigint;
  v_oldest_refund:=(v_health#>>'{refund_recovery,oldest_requested_at}')::timestamptz;
  -- An old failed payout can remain failed even after Stripe creates a replacement.
  select count(*) into v_failed_payouts
  from actv_payments.settlements s
  where s.live_mode=p_live_mode and s.state='failed'
    and (s.recorded_at>=v_now-interval '24 hours' or exists (
      select from actv_payments.provider_events e
      where e.live_mode=s.live_mode and e.account_id=s.account_id
        and e.object_id=s.payout_id and e.type='payout.failed'
        and e.received_at>=v_now-interval '24 hours'
    ));

  if v_overdue>0 then v_signals:=array_append(v_signals,'webhooks_overdue'); end if;
  if v_missing_folios>0 then v_signals:=array_append(v_signals,'captured_without_eligible_folios'); end if;
  if v_failing_refunds>0 or v_oldest_refund<=v_now-interval '10 minutes' then
    v_signals:=array_append(v_signals,'refund_recovery_attention');
  end if;
  if v_failed_payouts>0 then v_signals:=array_append(v_signals,'failed_payouts_last_24h'); end if;

  v_metrics:=jsonb_build_object(
    'webhooks_pending',(v_health#>>'{webhooks,pending}')::bigint,
    'webhooks_overdue',v_overdue,
    'webhooks_failed',(v_health#>>'{webhooks,failed}')::bigint,
    'oldest_webhook_age_seconds',(v_health#>>'{webhooks,oldest_age_seconds}')::bigint,
    'captured_without_eligible_folios',v_missing_folios,
    'refund_recovery_pending',(v_health#>>'{refund_recovery,pending}')::bigint,
    'refund_recovery_failed',v_failing_refunds,
    'failed_payouts_last_24h',v_failed_payouts
  );
  insert into actv_payments.health_samples values(p_live_mode,v_minute,v_signals,v_metrics)
  on conflict(live_mode,observed_minute) do update
    set signals=excluded.signals,metrics=excluded.metrics;

  if coalesce(v_previous,'{}')<>v_signals then
    insert into actv_payments.health_incidents(live_mode,observed_at,signals,metrics,delivery_state)
      values(p_live_mode,v_now,v_signals,v_metrics,case when p_notify then 'pending' else 'disabled' end);
  end if;

  delete from actv_payments.health_samples
    where live_mode=p_live_mode and observed_minute<v_minute-interval '7 days';
  delete from actv_payments.health_incidents
    where live_mode=p_live_mode and observed_at<v_now-interval '30 days';
end $$;

create function actv_payments.deliver_payment_health(p_live_mode boolean)
returns void language plpgsql set search_path='' as $$
declare
  v_alert actv_payments.health_incidents;
  v_status integer;
  v_url text;
  v_token text;
  v_vault_prefix text;
  v_request_id bigint;
begin
  if p_live_mode is null then
    raise exception 'Explicit Stripe mode required' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(17941003,p_live_mode::integer) then return; end if;
  select * into v_alert from actv_payments.health_incidents
    where live_mode=p_live_mode and delivery_state='pending'
    order by observed_at,id limit 1 for update;
  if not found or v_alert.delivery_after>now() then return; end if;

  if v_alert.net_request_id is not null then
    select status_code into v_status from net._http_response where id=v_alert.net_request_id;
    if v_status between 200 and 299 then
      update actv_payments.health_incidents set delivery_state='sent',delivery_http_status=v_status where id=v_alert.id;
      return;
    end if;
    if v_alert.delivery_attempts>=5 or
      (v_status between 300 and 499 and v_status not in (408,425,429)) then
      update actv_payments.health_incidents set delivery_state='failed',delivery_http_status=v_status where id=v_alert.id;
      return;
    end if;
  end if;

  v_vault_prefix:=case when p_live_mode then 'actv_health_live_' else 'actv_health_sandbox_' end;
  select decrypted_secret into strict v_url from vault.decrypted_secrets where name=v_vault_prefix||'webhook_url';
  select decrypted_secret into strict v_token from vault.decrypted_secrets where name=v_vault_prefix||'webhook_token';
  if v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^#[:space:]]*)?$'
    or length(v_token)<32 or v_token ~ '[[:cntrl:][:space:]]' then
    raise exception 'Invalid ACTV incident webhook configuration';
  end if;

  v_request_id:=net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token,
      'Idempotency-Key',v_alert.id::text),
    body:=jsonb_build_object(
      'schema_version',1,'id',v_alert.id,'observed_at',v_alert.observed_at,
      'mode',case when p_live_mode then 'live' else 'sandbox' end,
      'event',case when cardinality(v_alert.signals)=0 then 'recovery' else 'incident' end,
      'signals',v_alert.signals,'metrics',v_alert.metrics
    ),
    timeout_milliseconds:=10000
  );

  update actv_payments.health_incidents
    set net_request_id=v_request_id,delivery_attempts=v_alert.delivery_attempts+1,
        delivery_after=now()+make_interval(mins=>2*(1<<v_alert.delivery_attempts)),
        delivery_http_status=v_status
    where id=v_alert.id;
end $$;

revoke all on actv_payments.health_samples,actv_payments.health_incidents from public,anon,authenticated,service_role;
revoke all on function actv_payments.observe_payment_health(boolean,boolean),
  actv_payments.deliver_payment_health(boolean) from public,anon,authenticated,service_role;

commit;

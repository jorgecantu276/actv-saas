begin;

create function actv_payments.payment_health(p_live_mode boolean)
returns jsonb
language sql stable
set search_path=''
as $$
  with pending_events as (
    select e.event_id,e.account_id,e.type,e.object_id,e.order_id,
           e.received_at,e.retry_after,e.attempts,e.failure_code
    from actv_payments.provider_events e
    where e.live_mode=p_live_mode and e.processed_at is null
  ), missing_folios as (
    select c.order_id,c.account_id,c.charge_id,c.provider_payment_id,
           c.captured_at,c.amount,c.currency,o.event_id,o.channel,o.state,o.item_count
    from actv_payments.captures c
    join actv_payments.orders o on o.id=c.order_id
    where c.live_mode=p_live_mode
      and not exists (
        select 1 from actv_payments.items i
        join public.inscripciones r on r.actv_order_item_id=i.id
        where i.order_id=c.order_id and r.actv_eligible is true
      )
      and not exists (
        -- The same adjustments that suspend eligibility in refresh_eligibility.
        select 1 from actv_payments.adjustments a
        where (a.account_id,a.live_mode,a.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
          and ((a.kind='refund' and a.state='succeeded')
            or (a.kind='dispute' and a.state not in ('won','warning_closed','warning_needs_response','warning_under_review')))
      )
  ), failed_payouts as (
    select s.account_id,s.payout_id,s.amount,s.currency,s.recorded_at
    from actv_payments.settlements s
    where s.live_mode=p_live_mode and s.state='failed'
  ), pending_refunds as (
    select r.id,r.order_id,c.account_id,c.charge_id,r.provider_refund_id,r.requested_at,
           a.state,r.recovery_after,r.recovery_attempts,r.recovery_failure
    from actv_payments.refund_requests r
    join actv_payments.orders o on o.id=r.order_id
    join actv_payments.captures c on c.order_id=o.id
      and (c.account_id,c.live_mode,c.provider_payment_id,c.amount,c.currency)=
        (o.account_id,o.live_mode,o.provider_payment_id,o.amount,o.currency)
    left join actv_payments.adjustments a
      on (a.account_id,a.live_mode,a.reference,a.payment_id,a.amount,a.currency)=
        (c.account_id,c.live_mode,r.provider_refund_id,c.provider_payment_id,c.amount,c.currency)
      and a.kind='refund'
    where o.live_mode=p_live_mode and o.channel in ('online','terminal')
      and c.charge_id is not null and (a.state is null or a.state in ('pending','requires_action'))
  )
  select jsonb_build_object(
    'live_mode',p_live_mode,
    'observed_at',now(),
    'webhooks',(
      select jsonb_build_object(
        'pending',count(*),
        'due',count(*) filter (where e.retry_after<=now()),
        'overdue',count(*) filter (where e.received_at<now()-interval '5 minutes'),
        'failed',count(*) filter (where e.failure_code is not null),
        'oldest_received_at',min(e.received_at),
        'oldest_age_seconds',floor(extract(epoch from(now()-min(e.received_at))))::bigint,
        'earliest_retry_at',min(e.retry_after),
        'max_attempts',coalesce(max(e.attempts),0),
        'examples',coalesce((
          select jsonb_agg(to_jsonb(sample) order by sample.received_at,sample.event_id,sample.account_id)
          from (
            select * from pending_events pe
            where pe.failure_code is not null or pe.received_at<now()-interval '5 minutes'
            order by pe.received_at,pe.event_id,pe.account_id limit 20
          ) sample
        ),'[]'::jsonb)
      )
      from pending_events e
    ),
    'refund_recovery',(
      select jsonb_build_object(
        'pending',count(*),
        'due',count(*) filter (where r.recovery_after<=now()),
        'failed',count(*) filter (where r.recovery_failure is not null),
        'oldest_requested_at',min(r.requested_at),
        'max_attempts',coalesce(max(r.recovery_attempts),0),
        'examples',coalesce((
          select jsonb_agg(to_jsonb(sample) order by sample.requested_at,sample.id)
          from (select * from pending_refunds order by requested_at,id limit 20) sample
        ),'[]'::jsonb)
      )
      from pending_refunds r
    ),
    'counts',jsonb_build_object(
      'captured_without_eligible_folios',(select count(*) from missing_folios),
      'failed_payouts',(select count(*) from failed_payouts)
    ),
    'captured_without_eligible_folios',coalesce((
      select jsonb_agg(to_jsonb(sample) order by sample.captured_at,sample.order_id)
      from (select * from missing_folios order by captured_at,order_id limit 20) sample
    ),'[]'::jsonb),
    'failed_payouts',coalesce((
      select jsonb_agg(to_jsonb(sample) order by sample.recorded_at desc,sample.payout_id,sample.account_id)
      from (select * from failed_payouts order by recorded_at desc,payout_id,account_id limit 20) sample
    ),'[]'::jsonb)
  )
$$;

create function public.actv_payment_health(p_live_mode boolean)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
begin
  if not actv_payments.is_manager(auth.uid()) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_live_mode is null then
    raise exception 'Se requiere el modo de Stripe' using errcode='22023';
  end if;
  return actv_payments.payment_health(p_live_mode);
end $$;

revoke all on function actv_payments.payment_health(boolean) from public, anon, authenticated, service_role;
revoke all on function public.actv_payment_health(boolean) from public, anon, authenticated, service_role;
grant execute on function public.actv_payment_health(boolean) to authenticated;

commit;

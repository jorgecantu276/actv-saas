begin;

alter table actv_payments.provider_events
  add column retry_lease uuid,
  add column retry_lease_until timestamptz,
  add constraint actv_stripe_retry_lease_pair check ((retry_lease is null)=(retry_lease_until is null));

-- Claim only when a worker is about to process an event. The lease outlasts
-- the hosted Edge worker's maximum duration and expires after a crashed worker.
create function public.actv_claim_stripe_event_retry(p_live_mode boolean)
returns jsonb language sql security definer set search_path='' as $$
  with due as (
    select account_id,live_mode,event_id
    from actv_payments.provider_events e
    where e.live_mode=p_live_mode and e.processed_at is null and e.retry_after<=now()
      and (e.retry_lease_until is null or e.retry_lease_until<=now())
    order by e.retry_after,e.received_at,e.event_id,e.account_id
    limit 1 for update skip locked
  ), claimed as (
    update actv_payments.provider_events e
    set retry_lease=gen_random_uuid(),retry_lease_until=now()+interval '8 minutes'
    from due where (e.account_id,e.live_mode,e.event_id)=(due.account_id,due.live_mode,due.event_id)
    returning e.account_id,e.live_mode,e.event_id,e.type as event_type,e.object_id,e.order_id,e.retry_lease as lease
  )
  select to_jsonb(claimed) from claimed
$$;

create function public.actv_finish_stripe_event_retry(
  p_account_id text,p_live_mode boolean,p_event_id text,p_lease uuid,p_failure_code text default null
) returns boolean language sql security definer set search_path='' as $$
  with acknowledged as (
    update actv_payments.provider_events
    set processed_at=case when p_failure_code is null then now() else processed_at end,
      attempts=case when p_failure_code is null then attempts else attempts+1 end,
      retry_after=case when p_failure_code is null then retry_after
        else now()+make_interval(secs=>least(3600,15*(1<<least(attempts,8)))) end,
      failure_code=coalesce(left(p_failure_code,80),failure_code),
      retry_lease=null,retry_lease_until=null
    where (account_id,live_mode,event_id,retry_lease)=(p_account_id,p_live_mode,p_event_id,p_lease)
      and processed_at is null and retry_lease_until>now()
    returning 1
  )
  select exists(select from acknowledged)
$$;

create or replace function public.actv_finish_stripe_event(p_account_id text,p_live_mode boolean,p_event_id text)
returns void language sql security definer set search_path='' as $$
  update actv_payments.provider_events
    set processed_at=now(),retry_lease=null,retry_lease_until=null
  where (account_id,live_mode,event_id)=(p_account_id,p_live_mode,p_event_id) and processed_at is null
$$;

create or replace function public.actv_checked_stripe_event(
  p_account_id text,p_live_mode boolean,p_event_id text,p_failure_code text default null
) returns void language sql security definer set search_path='' as $$
  update actv_payments.provider_events set attempts=attempts+1,
    retry_after=now()+make_interval(secs=>least(3600,15*(1<<least(attempts,8)))),
    failure_code=left(p_failure_code,80)
  where (account_id,live_mode,event_id)=(p_account_id,p_live_mode,p_event_id)
    and processed_at is null and retry_lease is null and retry_after<=now()
$$;

create function public.actv_pending_stripe_orders(p_live_mode boolean,p_limit integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id',o.id,'channel',o.channel,'state',o.state,
    'account_id',o.account_id,'live_mode',o.live_mode,'provider_session_id',o.provider_session_id,
    'provider_payment_id',o.provider_payment_id,'expires_at',o.expires_at)
    order by o.checked_at nulls first,o.created_at,o.id),'[]'::jsonb)
  from (
    select * from actv_payments.orders
    where live_mode=p_live_mode and state='pending'
      and coalesce(provider_session_id,provider_payment_id) is not null
      and (checked_at is null or checked_at<now()-interval '30 seconds')
    order by checked_at nulls first,created_at,id limit greatest(0,least(coalesce(p_limit,0),20))
  ) o
$$;

revoke all on function public.actv_claim_stripe_event_retry(boolean),
  public.actv_finish_stripe_event_retry(text,boolean,text,uuid,text),
  public.actv_pending_stripe_orders(boolean,integer) from public,anon,authenticated;
grant execute on function public.actv_claim_stripe_event_retry(boolean),
  public.actv_finish_stripe_event_retry(text,boolean,text,uuid,text),
  public.actv_pending_stripe_orders(boolean,integer) to service_role;

commit;

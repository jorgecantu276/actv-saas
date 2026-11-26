begin;

create function public.actv_claim_received_stripe_event(p_live_mode boolean,p_account_id text,p_event_id text)
returns jsonb language sql security definer set search_path='' as $$
  with claimed as (
    update actv_payments.provider_events e
      set retry_lease=gen_random_uuid(),retry_lease_until=now()+interval '8 minutes'
      where (e.live_mode,e.account_id,e.event_id)=(p_live_mode,p_account_id,p_event_id)
        and e.processed_at is null and e.retry_after<=now()
        and (e.retry_lease_until is null or e.retry_lease_until<=now())
      returning e.account_id,e.live_mode,e.event_id,e.type as event_type,e.object_id,e.order_id,e.retry_lease as lease
  )
  select to_jsonb(claimed) from claimed
$$;

revoke all on function public.actv_claim_received_stripe_event(boolean,text,text) from public,anon,authenticated;
grant execute on function public.actv_claim_received_stripe_event(boolean,text,text) to service_role;

commit;

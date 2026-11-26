begin;

alter table actv_payments.refund_requests
  add column recovery_attempts integer not null default 0,
  add column recovery_after timestamptz not null default (now()+interval '2 minutes'),
  add column recovery_failure text;

create index actv_admin_refund_recovery_due
  on actv_payments.refund_requests(recovery_after,id);

create function public.actv_claim_refund_recovery(p_live_mode boolean,p_limit integer)
returns jsonb language sql security definer set search_path='' as $$
  with due as (
    select r.id,c.account_id,c.charge_id,c.provider_payment_id,c.amount,c.currency
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
      and c.charge_id is not null and r.recovery_after<=now()
      and (a.state is null or a.state in ('pending','requires_action'))
    order by r.recovery_after,r.id
    limit greatest(0,least(2,coalesce(p_limit,0)))
    for update of r skip locked
  ), claimed as (
    update actv_payments.refund_requests r
      set recovery_attempts=least(r.recovery_attempts+1,24),
          recovery_after=now()+make_interval(mins=>least(240,2*(1<<least(r.recovery_attempts,7))))
      from due where r.id=due.id
      returning r.id,r.order_id,r.provider_refund_id,r.recovery_after as lease,r.recovery_attempts,
        due.account_id,due.charge_id,due.provider_payment_id,due.amount,due.currency
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) from claimed
$$;

create function public.actv_note_refund_recovery(p_request uuid,p_lease timestamptz,p_failure text)
returns void language sql security definer set search_path='' as $$
  update actv_payments.refund_requests set recovery_failure=left(p_failure,80)
  where id=p_request and recovery_after=p_lease
$$;

create function public.actv_record_admin_refund(
  p_live_mode boolean,p_order uuid,p_request uuid,p_refund text,p_status text
) returns text language plpgsql security definer set search_path='' as $$
declare
  v_order actv_payments.orders;
  v_capture actv_payments.captures;
  v_request actv_payments.refund_requests;
  v_status text;
begin
  if p_refund is null or p_refund !~ '^re_[a-zA-Z0-9]+$'
    or p_status is null or p_status not in ('succeeded','pending','requires_action','failed','canceled')
    then raise exception 'Estado de reembolso inválido' using errcode='22023'; end if;
  select * into strict v_order from actv_payments.orders
    where id=p_order and live_mode=p_live_mode and channel in ('online','terminal') for update;
  select * into strict v_request from actv_payments.refund_requests where id=p_request and order_id=p_order for update;
  select * into strict v_capture from actv_payments.captures c where c.order_id=v_order.id
    and (c.account_id,c.live_mode,c.provider_payment_id,c.amount,c.currency)=
      (v_order.account_id,v_order.live_mode,v_order.provider_payment_id,v_order.amount,v_order.currency)
    and c.charge_id is not null;
  if v_request.provider_refund_id is not null and v_request.provider_refund_id<>p_refund
    then raise exception 'Solicitud de reembolso no coincide' using errcode='23514'; end if;

  perform public.actv_record_adjustment(v_capture.account_id,p_live_mode,p_refund,'refund',
    v_capture.provider_payment_id,v_capture.amount,v_capture.currency,p_status);
  select a.state into strict v_status from actv_payments.adjustments a
    where (a.account_id,a.live_mode,a.reference,a.payment_id,a.amount,a.currency)=
      (v_capture.account_id,p_live_mode,p_refund,v_capture.provider_payment_id,v_capture.amount,v_capture.currency)
      and a.kind='refund';
  update actv_payments.refund_requests
    set provider_refund_id=p_refund,provider_status=v_status,observed_at=now(),recovery_failure=null,
      recovery_after=greatest(recovery_after+interval '1 microsecond',now()+interval '2 minutes')
    where id=p_request;
  return v_status;
end $$;

create function public.actv_admin_finalize_refund(
  p_operator uuid,p_live_mode boolean,p_order uuid,p_request uuid,p_refund text,p_status text
) returns text language plpgsql security definer set search_path='' as $$
begin
  if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
  return public.actv_record_admin_refund(p_live_mode,p_order,p_request,p_refund,p_status);
end $$;

create or replace function public.actv_admin_finish_refund(
  p_operator uuid,p_live_mode boolean,p_order uuid,p_request uuid,p_refund text,p_status text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.actv_admin_finalize_refund(p_operator,p_live_mode,p_order,p_request,p_refund,p_status);
end $$;

revoke all on function public.actv_claim_refund_recovery(boolean,integer),
  public.actv_note_refund_recovery(uuid,timestamptz,text),
  public.actv_admin_finalize_refund(uuid,boolean,uuid,uuid,text,text),
  public.actv_record_admin_refund(boolean,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.actv_claim_refund_recovery(boolean,integer),
  public.actv_note_refund_recovery(uuid,timestamptz,text),
  public.actv_admin_finalize_refund(uuid,boolean,uuid,uuid,text,text),
  public.actv_record_admin_refund(boolean,uuid,uuid,text,text) to service_role;

commit;

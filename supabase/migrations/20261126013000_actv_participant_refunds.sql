begin;

-- Every refund reserves original item values under the same order lock as captures
-- and legacy refunds. A timeout never releases a reservation.
create table actv_payments.participant_refund_requests (
 id uuid primary key, order_id uuid not null references actv_payments.orders,
 item_ids uuid[] not null, amount bigint not null check(amount>0),
 requested_by uuid not null, requested_at timestamptz not null default now(),
 reason text not null check(length(trim(reason)) between 3 and 500),
 refund_application_fee boolean not null, participant_scoped boolean not null,
 provider_refund_id text unique, status text not null default 'requested'
 check(status in ('requested','pending','requires_action','succeeded','failed','canceled')),
 observed_at timestamptz,
 recovery_after timestamptz not null default now(), recovery_attempts integer not null default 0,
 check(cardinality(item_ids)>0)
);
create index on actv_payments.participant_refund_requests(order_id);
create function actv_payments.guard_participant_refund() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (new.id,new.order_id,new.item_ids,new.amount,new.requested_by,new.requested_at,new.reason,new.refund_application_fee,new.participant_scoped)
 is distinct from (old.id,old.order_id,old.item_ids,old.amount,old.requested_by,old.requested_at,old.reason,old.refund_application_fee,old.participant_scoped)
 then raise check_violation using message='Solicitud de reembolso inmutable'; end if;
 return new;
end $$;
create trigger actv_participant_refund_immutable before update or delete on actv_payments.participant_refund_requests
 for each row execute function actv_payments.guard_participant_refund();
create function actv_payments.sync_participant_refund() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='refund' then
 update actv_payments.participant_refund_requests r set status=new.state,observed_at=now()
 from actv_payments.captures c where r.order_id=c.order_id and r.provider_refund_id=new.reference
 and (new.account_id,new.live_mode,new.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
 and new.amount=r.amount and new.currency=c.currency;
 end if;
 return new;
end $$;
create trigger actv_sync_participant_refund after insert or update on actv_payments.adjustments
 for each row execute function actv_payments.sync_participant_refund();
create table actv_payments.cash_refund_movements (
 request_id uuid primary key references actv_payments.participant_refund_requests,
 shift_id uuid not null references actv_payments.shifts, amount bigint not null check(amount>0),
 recorded_by uuid not null, recorded_at timestamptz not null default now()
);
create trigger actv_cash_refund_immutable before update or delete on actv_payments.cash_refund_movements
 for each row execute function actv_payments.guard_registration_audit();
alter table actv_payments.participant_refund_requests enable row level security;
alter table actv_payments.cash_refund_movements enable row level security;

create function actv_payments.financial_order_state(p_order uuid) returns jsonb
language sql stable set search_path='' as $$
 with c as (select c.*,o.mercadopago_refunded,o.mercadopago_disputed from actv_payments.captures c
 join actv_payments.orders o on o.id=c.order_id where c.order_id=p_order),
 a as (select coalesce(sum(a.amount) filter(where a.kind='refund' and a.state='succeeded'),0) refunded,
 coalesce(bool_or(a.kind='dispute' and a.state not in ('won','warning_closed','warning_needs_response','warning_under_review')),false) disputed,
 coalesce(bool_or(a.kind='refund' and a.state in ('pending','requires_action')),false) pending,
 coalesce(bool_or(a.kind='refund' and a.state='succeeded' and not exists (
 select 1 from actv_payments.participant_refund_requests r where r.order_id=p_order
 and r.provider_refund_id=a.reference and r.amount=a.amount and r.participant_scoped)),false) unmapped
 from c join actv_payments.adjustments a on (a.account_id,a.live_mode,a.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)),
 r as (select coalesce(sum(amount) filter(where status='succeeded'),0) refunded,
 coalesce(sum(amount) filter(where status in ('requested','pending','requires_action')),0) pending,
 coalesce(bool_or(status='succeeded' and not participant_scoped),false) whole
 from actv_payments.participant_refund_requests where order_id=p_order)
 select jsonb_build_object('captured',coalesce(c.amount,0),'refunded',
 coalesce(case when c.shift_id is not null then r.refunded when c.account_id is null then c.mercadopago_refunded else a.refunded end,0),
 'pending',r.pending,'hold',c.order_id is null or r.pending>0 or r.whole or a.pending or a.disputed or a.unmapped
 or coalesce(c.mercadopago_disputed,false) or coalesce(c.mercadopago_refunded,0)>0)
 from (select 1) x left join c on true cross join a cross join r
$$;

create function actv_payments.financial_item_state(p_order uuid)
returns table(item_id uuid,eligible boolean,refunded_minor bigint,mapped boolean)
language sql stable set search_path='' as $$
 select i.id,not coalesce((s.j->>'hold')::boolean,true) and not exists(
 select 1 from actv_payments.participant_refund_requests r where r.order_id=p_order
 and i.id=any(r.item_ids) and (r.status='succeeded' and (
 exists(select 1 from actv_payments.cash_refund_movements m where m.request_id=r.id)
 or exists(select 1 from actv_payments.captures c join actv_payments.adjustments a
 on (a.account_id,a.live_mode,a.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
 where c.order_id=p_order and a.reference=r.provider_refund_id and a.kind='refund' and a.state='succeeded')))),
 case when exists(select 1 from actv_payments.participant_refund_requests r where r.order_id=p_order
 and i.id=any(r.item_ids) and r.status='succeeded') then i.amount else 0 end,
 exists(select 1 from actv_payments.participant_refund_requests r where r.order_id=p_order and i.id=any(r.item_ids))
 from actv_payments.items i cross join lateral(select actv_payments.financial_order_state(p_order) j) s where i.order_id=p_order
$$;

create or replace function actv_payments.refresh_eligibility(p_order uuid) returns boolean
language plpgsql set search_path='' as $$
declare j jsonb; ok boolean;
begin
 if not exists(select 1 from actv_payments.captures where order_id=p_order) then return false; end if;
 j:=actv_payments.financial_order_state(p_order);
 update public.inscripciones r set actv_eligible=f.eligible from actv_payments.financial_item_state(p_order) f
 where r.actv_order_item_id=f.item_id and r.actv_eligible is distinct from f.eligible;
 ok:=not (j->>'hold')::boolean and (j->>'refunded')::bigint=0 and (j->>'captured')::bigint>0;
 if not ok then update actv_payments.orders set state=case when (j->>'refunded')::bigint>=(j->>'captured')::bigint
 and (j->>'captured')::bigint>0 then 'voided' else 'review' end where id=p_order;
 elsif exists(select 1 from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where i.order_id=p_order)
 then update actv_payments.orders set state='issued' where id=p_order; end if;
 return ok;
end $$;

create function public.actv_participant_refund_detail(p_order_id uuid default null,p_registration_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare oid uuid:=p_order_id;
begin
 if not actv_payments.is_manager(auth.uid()) then raise exception 'No autorizado' using errcode='42501'; end if;
 if oid is null then select i.order_id into oid from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where r.id=p_registration_id; end if;
 if oid is null then raise exception 'Pedido no encontrado'; end if;
 return (select jsonb_build_object('id',o.id,'channel',o.channel,'provider',o.payment_provider,
 'financial',actv_payments.financial_order_state(o.id),'shift',public.actv_cash_shift(),
 'items',(select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'amount',i.amount,'eligible',f.eligible,
 'number',i.number,'registration_id',registration.id,'folio',registration.folio_asignado,
 'participant_name',nullif(trim(concat_ws(' ',
 coalesce(snapshot.effective#>>'{participant,nombre}',i.accepted_snapshot#>>'{participant,nombre}',i.participant->>'nombre'),
 coalesce(snapshot.effective#>>'{participant,apellido}',i.accepted_snapshot#>>'{participant,apellido}',i.participant->>'apellido'))),''),
 'refunded',f.refunded_minor,'reserved',exists(select 1 from actv_payments.participant_refund_requests r
 where r.order_id=o.id and i.id=any(r.item_ids) and r.status not in ('failed','canceled')) ) order by i.number)
 from actv_payments.items i join actv_payments.financial_item_state(o.id) f on f.item_id=i.id
 left join public.inscripciones registration on registration.actv_order_item_id=i.id
 left join actv_payments.registration_snapshots snapshot on snapshot.registration_id=registration.id where i.order_id=o.id),
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by requested_at desc) from actv_payments.participant_refund_requests r where r.order_id=o.id),'[]'::jsonb))
 from actv_payments.orders o where o.id=oid);
end $$;

create function public.actv_begin_participant_refund(p_operator uuid,p_live_mode boolean,p_order uuid,p_request uuid,
 p_items uuid[],p_reason text,p_refund_application_fee boolean,p_participant_scoped boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o actv_payments.orders; c actv_payments.captures; r actv_payments.participant_refund_requests;
 ids uuid[]; total bigint; n integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into strict o from actv_payments.orders where id=p_order for update;
 select * into strict c from actv_payments.captures where order_id=p_order;
 select array_agg(distinct x order by x) into ids from unnest(p_items) x;
 if p_request is null or ids is null or array_position(ids,null) is not null or cardinality(ids)<>cardinality(p_items)
 or length(trim(coalesce(p_reason,''))) not between 3 and 500 or p_refund_application_fee is null or p_participant_scoped is null
 or o.live_mode is distinct from p_live_mode or o.payment_provider='mercadopago'
 or (c.amount,c.currency,c.live_mode) is distinct from (o.amount,o.currency,o.live_mode)
 or (o.payment_provider='stripe' and ((c.account_id,c.provider_payment_id) is distinct from (o.account_id,o.provider_payment_id)
 or c.charge_id is null)) then raise exception 'Solicitud inválida'; end if;
 select * into r from actv_payments.participant_refund_requests where id=p_request;
 if found then
 if r.order_id<>p_order or r.item_ids<>ids or r.reason<>trim(p_reason) or r.refund_application_fee<>p_refund_application_fee
 or r.participant_scoped<>p_participant_scoped or r.requested_by<>p_operator then raise exception 'Solicitud ya registrada con otros datos'; end if;
 else
 select count(*),sum(amount) into n,total from actv_payments.items where order_id=p_order and id=any(ids);
 if n<>cardinality(ids) or exists(select 1 from actv_payments.refund_requests where order_id=p_order and coalesce(provider_status,'requested') not in ('failed','canceled'))
 or exists(select 1 from actv_payments.participant_refund_requests where order_id=p_order
 and status not in ('failed','canceled') and item_ids && ids)
 or exists(select 1 from actv_payments.adjustments a where (a.account_id,a.live_mode,a.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
 and ((a.kind='dispute' and a.state not in ('won','warning_closed','warning_needs_response','warning_under_review'))
 or (a.kind='refund' and a.state not in ('failed','canceled') and not exists(select 1 from actv_payments.participant_refund_requests x where x.provider_refund_id=a.reference and x.order_id=p_order))))
 or total+coalesce((select sum(amount) from actv_payments.participant_refund_requests where order_id=p_order and status not in ('failed','canceled')),0)>c.amount
 then raise exception 'Reembolso reservado o requiere conciliación' using errcode='23514'; end if;
 insert into actv_payments.participant_refund_requests(id,order_id,item_ids,amount,requested_by,reason,refund_application_fee,participant_scoped)
 values(p_request,p_order,ids,total,p_operator,trim(p_reason),p_refund_application_fee,p_participant_scoped) returning * into r;
 perform actv_payments.refresh_eligibility(p_order);
 end if;
 return to_jsonb(r)||jsonb_build_object('account_id',c.account_id,'charge_id',c.charge_id,'payment_id',c.provider_payment_id,
 'currency',c.currency,'captured',c.amount,'channel',o.channel,'live_mode',o.live_mode);
end $$;

create function public.actv_record_participant_refund(p_live_mode boolean,p_request uuid,p_refund text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r actv_payments.participant_refund_requests; c actv_payments.captures; oid uuid; canonical text;
begin
 select order_id into strict oid from actv_payments.participant_refund_requests where id=p_request;
 perform 1 from actv_payments.orders where id=oid for update;
 select * into strict r from actv_payments.participant_refund_requests where id=p_request for update;
 select * into strict c from actv_payments.captures where order_id=oid;
 if c.live_mode is distinct from p_live_mode or c.account_id is null or p_refund is null or p_refund !~ '^re_[A-Za-z0-9]+$'
 or p_status is null or p_status not in ('pending','requires_action','succeeded','failed','canceled')
 or (r.provider_refund_id is not null and r.provider_refund_id<>p_refund) then raise exception 'Respuesta inválida'; end if;
 update actv_payments.participant_refund_requests set provider_refund_id=p_refund where id=p_request;
 perform public.actv_record_adjustment(c.account_id,c.live_mode,p_refund,'refund',c.provider_payment_id,r.amount,c.currency,p_status);
 select state into strict canonical from actv_payments.adjustments where account_id=c.account_id and live_mode=c.live_mode and reference=p_refund;
 update actv_payments.participant_refund_requests set status=canonical,observed_at=now() where id=p_request;
 perform actv_payments.refresh_eligibility(oid);
 return jsonb_build_object('id',p_request,'status',canonical,'amount',r.amount);
end $$;

create function public.actv_check_participant_refund_provider(p_request uuid,p_refunds jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare oid uuid; c actv_payments.captures; x jsonb;
begin
 select order_id into strict oid from actv_payments.participant_refund_requests where id=p_request;
 perform 1 from actv_payments.orders where id=oid for update;
 select * into strict c from actv_payments.captures where order_id=oid;
 for x in select value from jsonb_array_elements(p_refunds) loop
 if x->>'status' not in ('failed','canceled') and not exists(select 1 from actv_payments.adjustments a
 where (a.account_id,a.live_mode,a.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
 and a.kind='refund' and a.reference=x->>'id' and a.amount=(x->>'amount')::bigint and a.state=x->>'status')
 then raise exception 'Reembolso del proveedor requiere conciliación' using errcode='23514'; end if;
 end loop;
end $$;

create function public.actv_pending_participant_refunds(p_live_mode boolean,p_limit integer)
returns jsonb language sql security definer set search_path='' as $$
 with due as (select r.id from actv_payments.participant_refund_requests r
 join actv_payments.orders o on o.id=r.order_id where o.live_mode=p_live_mode and o.channel<>'cash'
 and r.status in ('requested','pending','requires_action') and r.recovery_after<=now()
 order by r.recovery_after,r.id limit least(greatest(p_limit,1),5) for update of r skip locked),
 claimed as(update actv_payments.participant_refund_requests r set recovery_attempts=least(r.recovery_attempts+1,24),
 recovery_after=now()+make_interval(mins=>least(240,2*(r.recovery_attempts+1))) from due where r.id=due.id returning r.*)
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select r.*,c.account_id,c.charge_id,c.provider_payment_id payment_id,c.currency,c.amount captured,o.live_mode,o.channel
 from claimed r join actv_payments.orders o on o.id=r.order_id join actv_payments.captures c on c.order_id=o.id) x
$$;

create function public.actv_cash_participant_refund(p_order uuid,p_request uuid,p_items uuid[],p_reason text,
 p_participant_scoped boolean,p_shift uuid,p_disbursed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o actv_payments.orders; s actv_payments.shifts; j jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.is_manager(auth.uid()) or p_disbursed is distinct from true then raise exception 'Confirmación de entrega requerida' using errcode='42501'; end if;
 select * into strict o from actv_payments.orders where id=p_order for update;
 if o.channel<>'cash' then raise exception 'No es efectivo'; end if;
 j:=public.actv_begin_participant_refund(auth.uid(),o.live_mode,p_order,p_request,p_items,p_reason,false,p_participant_scoped);
 if exists(select 1 from actv_payments.cash_refund_movements where request_id=p_request and shift_id=p_shift) then return j; end if;
 select * into strict s from actv_payments.shifts where id=p_shift for update;
 if s.operator<>auth.uid() or s.closed_at is not null or exists(select 1 from actv_payments.cash_refund_movements where request_id=p_request)
 then raise exception 'Caja no disponible'; end if;
 if s.opening+(select coalesce(sum(amount),0) from actv_payments.captures where shift_id=p_shift)
 -(select coalesce(sum(amount),0) from actv_payments.cash_refund_movements where shift_id=p_shift)<(j->>'amount')::bigint then raise exception 'Efectivo insuficiente en caja'; end if;
 insert into actv_payments.cash_refund_movements values(p_request,p_shift,(j->>'amount')::bigint,auth.uid(),now());
 update actv_payments.participant_refund_requests set status='succeeded',observed_at=now() where id=p_request;
 perform actv_payments.refresh_eligibility(p_order);
 return j||jsonb_build_object('status','succeeded');
end $$;

-- Keep the legacy endpoint, sharing the same mutex and excluding all reservations.
alter function public.actv_admin_begin_refund(uuid,boolean,uuid,text,boolean) rename to actv_admin_begin_refund_legacy;
create function public.actv_admin_begin_refund(p_operator uuid,p_live_mode boolean,p_order uuid,p_reason text,p_refund_application_fee boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
 perform 1 from actv_payments.orders where id=p_order for update;
 if exists(select 1 from actv_payments.participant_refund_requests where order_id=p_order and status not in ('failed','canceled'))
 then raise exception 'Reembolso por participante reservado' using errcode='23514'; end if;
 return public.actv_admin_begin_refund_legacy(p_operator,p_live_mode,p_order,p_reason,p_refund_application_fee);
end $$;
revoke all on function public.actv_admin_begin_refund_legacy(uuid,boolean,uuid,text,boolean) from service_role;

create or replace function actv_payments.shift_json(p_shift uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'opened_at',s.opened_at,'closed_at',s.closed_at,'opening',s.opening,
 'cash_refunds',r.total,'refund_movements',r.movements,
 'expected',coalesce(s.expected,s.opening+(select coalesce(sum(amount),0) from actv_payments.captures where shift_id=s.id)-r.total),
 'counted',s.counted,'variance',s.counted-s.expected,'state',case when s.closed_at is null then 'open' else 'closed' end,
 'deposit_amount',s.deposit_amount,'deposit_reference',s.deposit_reference,'deposit_expected',s.counted-s.opening,
 'deposit_variance',s.deposit_amount-(s.counted-s.opening)) from actv_payments.shifts s
 cross join lateral(select coalesce(sum(amount),0) total,coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) movements
 from actv_payments.cash_refund_movements m where shift_id=s.id) r where s.id=p_shift
$$;
create or replace function public.actv_close_shift(p_shift_id uuid,p_counted bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s actv_payments.shifts;
begin
 if actv_payments.role(auth.uid()) is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into strict s from actv_payments.shifts where id=p_shift_id for update;
 if s.operator<>auth.uid() or p_counted is null or p_counted not between 0 and 100000000 then raise exception 'Conteo inválido'; end if;
 if s.closed_at is not null and s.counted<>p_counted then raise exception 'Corte ya registrado'; end if;
 if s.closed_at is null then update actv_payments.shifts set closed_at=now(),counted=p_counted,
 expected=(actv_payments.shift_json(p_shift_id)->>'expected')::bigint where id=p_shift_id; end if;
 return actv_payments.shift_json(p_shift_id);
end $$;

create or replace function public.actv_list_admin_outflows(
  p_operator uuid,p_live_mode boolean,p_from date,p_to date,p_offset integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_from timestamptz:=p_from::timestamp at time zone 'America/Matamoros';
  v_until timestamptz:=(p_to+1)::timestamp at time zone 'America/Matamoros';
begin
  if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_live_mode is null or p_from is null or p_to is null or p_to<p_from or p_to-p_from>92
    or p_offset is null or p_offset<0 then
    raise exception 'Filtro de pagos inválido' using errcode='22023';
  end if;
  return (
    with movements as (
      select a.reference as id,a.kind,a.amount,a.currency,a.state,a.recorded_at,
        o.id as order_id,e.nombre_carrera as label,o.channel
      from actv_payments.adjustments a
      join actv_payments.orders o on (o.account_id,o.live_mode,o.provider_payment_id)=(a.account_id,a.live_mode,a.payment_id)
      join public.eventos e on e.id=o.event_id
      where a.live_mode=p_live_mode and a.recorded_at>=v_from and a.recorded_at<v_until
      union all
      select m.id::text,'refund',m.amount,o.currency,'succeeded',m.recorded_at,o.id,e.nombre_carrera,o.channel
      from actv_payments.mercadopago_refund_movements m
      join actv_payments.orders o on o.id=m.order_id join public.eventos e on e.id=o.event_id
      where o.live_mode=p_live_mode and m.recorded_at>=v_from and m.recorded_at<v_until
      union all
      select m.request_id::text,'refund',m.amount,o.currency,'succeeded',m.recorded_at,o.id,e.nombre_carrera,o.channel
      from actv_payments.cash_refund_movements m join actv_payments.participant_refund_requests r on r.id=m.request_id
      join actv_payments.orders o on o.id=r.order_id join public.eventos e on e.id=o.event_id
      where o.live_mode=p_live_mode and m.recorded_at>=v_from and m.recorded_at<v_until
      union all
      select s.payout_id,'payout',s.amount,s.currency,s.state,s.recorded_at,null,g.name,null
      from actv_payments.settlements s
      join actv_payments.accounts a on (a.account_id,a.live_mode)=(s.account_id,s.live_mode)
      join actv_payments.organizers g on a.organizer_id=g.id
      where s.live_mode=p_live_mode and s.recorded_at>=v_from and s.recorded_at<v_until
    ), page as (
      select * from movements order by recorded_at desc,kind,id desc offset p_offset limit 26
    ), rows as (
      select * from page order by recorded_at desc,kind,id desc limit 25
    )
    select jsonb_build_object('rows',
      coalesce((select jsonb_agg(to_jsonb(r) order by r.recorded_at desc,r.kind,r.id desc) from rows r),'[]'::jsonb),
      'hasMore',(select count(*)>25 from page))
  );
end $$;

create or replace function public.actv_list_admin_payments(
  p_operator uuid,p_live_mode boolean,p_from date,p_to date,p_channel text,p_state text,p_search text,
  p_offset integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_from timestamptz:=p_from::timestamp at time zone 'America/Matamoros';
  v_until timestamptz:=(p_to+1)::timestamp at time zone 'America/Matamoros';
begin
  if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_live_mode is null or p_from is null or p_to is null or p_to<p_from or p_to-p_from>92
    or p_offset is null or p_offset<0 or char_length(coalesce(p_search,''))>120
    or p_channel not in ('online','terminal','cash')
    or p_state not in ('pending','issued','closed','review','voided') then
    raise exception 'Filtro de pagos inválido' using errcode='22023';
  end if;

  return (
    with page as (
      select o.id,o.account_id,o.provider_payment_id,o.live_mode,o.payment_provider,o.mercadopago_payment_id,o.mercadopago_refunded,o.state,o.channel,o.created_at,o.amount,
        coalesce(c.captured_at,o.created_at) as transaction_at,
        o.application_fee_amount,e.nombre_carrera as event_name,c.amount as captured,c.captured_at,
        refund.provider_refund_id,refund.provider_status,refund.requested_at as refund_requested_at
      from actv_payments.orders o join public.eventos e on e.id=o.event_id
      left join actv_payments.captures c on c.order_id=o.id
      left join actv_payments.refund_requests refund on refund.order_id=o.id
      where o.live_mode=p_live_mode and coalesce(c.captured_at,o.created_at)>=v_from
        and coalesce(c.captured_at,o.created_at)<v_until
        and (p_channel is null or o.channel=p_channel) and (p_state is null or o.state=p_state)
        and (coalesce(p_search,'')='' or o.id::text=p_search or o.mercadopago_payment_id=p_search or o.provider_payment_id=p_search or c.charge_id=p_search
          or strpos(lower(e.nombre_carrera),lower(p_search))>0 or exists (
            select from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
            where i.order_id=o.id and r.folio_asignado=p_search
          ))
      order by transaction_at desc,o.id desc offset p_offset limit 26
    ), rows as (
      select p.id,coalesce(p.provider_payment_id,p.mercadopago_payment_id) as provider_payment_id,p.payment_provider as provider,p.state,p.channel,p.transaction_at,p.amount,p.application_fee_amount,
        p.event_name,p.captured,p.captured_at,p.refund_requested_at,(actv_payments.financial_order_state(p.id)->>'refunded')::bigint as refunded,
        coalesce((select max(r.status) from actv_payments.participant_refund_requests r where r.order_id=p.id),a.refund_status,p.provider_status,
          case when p.refund_requested_at is not null then 'requested' end) as refund_status,
        f.folios
      from page p
      cross join lateral (
        select coalesce(sum(amount) filter (where kind='refund' and state='succeeded'),0) as refunded,
          max(state) filter (where reference=p.provider_refund_id) as refund_status
        from actv_payments.adjustments
        where (account_id,live_mode,payment_id)=(p.account_id,p.live_mode,p.provider_payment_id)
      ) a
      cross join lateral (
        select coalesce(jsonb_agg(r.folio_asignado order by i.number),'[]'::jsonb) as folios
        from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
        where i.order_id=p.id
      ) f
      order by p.transaction_at desc,p.id desc limit 25
    )
    select jsonb_build_object(
      'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.transaction_at desc,r.id desc) from rows r),'[]'::jsonb),
      'hasMore',(select count(*)>25 from page),
      'totals',jsonb_build_object(
        'captured',(select coalesce(sum(c.amount),0) from actv_payments.captures c
          join actv_payments.orders o on o.id=c.order_id
          where o.live_mode=p_live_mode and c.captured_at>=v_from and c.captured_at<v_until),
        'refunded',(select coalesce(sum(a.amount),0) from actv_payments.adjustments a
          join actv_payments.orders o on (o.account_id,o.live_mode,o.provider_payment_id)=(a.account_id,a.live_mode,a.payment_id)
          where a.live_mode=p_live_mode and a.recorded_at>=v_from and a.recorded_at<v_until
            and a.kind='refund' and a.state='succeeded')+
          (select coalesce(sum(m.amount),0) from actv_payments.mercadopago_refund_movements m
            join actv_payments.orders o on o.id=m.order_id
            where o.live_mode=p_live_mode and m.recorded_at>=v_from and m.recorded_at<v_until)+
          (select coalesce(sum(m.amount),0) from actv_payments.cash_refund_movements m
           join actv_payments.participant_refund_requests r on r.id=m.request_id join actv_payments.orders o on o.id=r.order_id
           where o.live_mode=p_live_mode and m.recorded_at>=v_from and m.recorded_at<v_until),
        'disputesLost',(select coalesce(sum(a.amount),0) from actv_payments.adjustments a
          join actv_payments.orders o on (o.account_id,o.live_mode,o.provider_payment_id)=(a.account_id,a.live_mode,a.payment_id)
          where a.live_mode=p_live_mode and a.recorded_at>=v_from and a.recorded_at<v_until
            and a.kind='dispute' and a.state='lost'))
    )
  );
end $$;


revoke all on all tables in schema actv_payments from anon,authenticated;
revoke all on function actv_payments.financial_order_state(uuid),actv_payments.financial_item_state(uuid),
 public.actv_participant_refund_detail(uuid,uuid),public.actv_begin_participant_refund(uuid,boolean,uuid,uuid,uuid[],text,boolean,boolean),
 public.actv_record_participant_refund(boolean,uuid,text,text),public.actv_cash_participant_refund(uuid,uuid,uuid[],text,boolean,uuid,boolean),
 public.actv_check_participant_refund_provider(uuid,jsonb),actv_payments.sync_participant_refund(),actv_payments.guard_participant_refund(),
 public.actv_pending_participant_refunds(boolean,integer),
 public.actv_admin_begin_refund(uuid,boolean,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.actv_participant_refund_detail(uuid,uuid),public.actv_cash_participant_refund(uuid,uuid,uuid[],text,boolean,uuid,boolean) to authenticated;
grant execute on function public.actv_begin_participant_refund(uuid,boolean,uuid,uuid,uuid[],text,boolean,boolean),
 public.actv_check_participant_refund_provider(uuid,jsonb),
 public.actv_pending_participant_refunds(boolean,integer),
 public.actv_record_participant_refund(boolean,uuid,text,text),public.actv_admin_begin_refund(uuid,boolean,uuid,text,boolean) to service_role;
commit;

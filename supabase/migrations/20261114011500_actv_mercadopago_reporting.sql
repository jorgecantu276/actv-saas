begin;

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
        p.event_name,p.captured,p.captured_at,p.refund_requested_at,a.refunded+p.mercadopago_refunded as refunded,
        coalesce(a.refund_status,p.provider_status,
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
            where o.live_mode=p_live_mode and m.recorded_at>=v_from and m.recorded_at<v_until),
        'disputesLost',(select coalesce(sum(a.amount),0) from actv_payments.adjustments a
          join actv_payments.orders o on (o.account_id,o.live_mode,o.provider_payment_id)=(a.account_id,a.live_mode,a.payment_id)
          where a.live_mode=p_live_mode and a.recorded_at>=v_from and a.recorded_at<v_until
            and a.kind='dispute' and a.state='lost'))
    )
  );
end $$;

create or replace function public.actv_admin_payment(p_operator uuid,p_live_mode boolean,p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not actv_payments.is_manager(p_operator) then raise exception 'No autorizado' using errcode='42501'; end if;
  select jsonb_build_object('id',o.id,'state',o.state,'channel',o.channel,'provider',o.payment_provider,'account_id',c.account_id,
    'charge_id',c.charge_id,'payment_id',c.provider_payment_id,'amount',c.amount,'currency',c.currency,
    'refund_request',case when r.id is not null then jsonb_build_object('id',r.id,'requested_at',r.requested_at,
      'requested_by',coalesce(p.email,r.requested_by::text),
      'reason',r.reason,'refund_application_fee',r.refund_application_fee,
      'provider_refund_id',r.provider_refund_id,'status',r.provider_status) end,
    'adjustments',coalesce(a.adjustments,'[]'::jsonb)||coalesce(m.adjustments,'[]'::jsonb))
  into strict v_result
  from actv_payments.orders o
  left join actv_payments.captures c on c.order_id=o.id
  left join actv_payments.refund_requests r on r.order_id=o.id
  left join public.perfiles p on p.id=r.requested_by
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id',x.reference,'kind',x.kind,'amount',x.amount,
      'status',x.state,'date',x.recorded_at) order by x.recorded_at desc) as adjustments
    from actv_payments.adjustments x
    where (x.account_id,x.live_mode,x.payment_id)=(c.account_id,c.live_mode,c.provider_payment_id)
  ) a
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id',r.id,'kind','refund','amount',r.amount,
      'status','succeeded','date',r.recorded_at) order by r.recorded_at desc) as adjustments
    from actv_payments.mercadopago_refund_movements r where r.order_id=o.id
  ) m
  where o.id=p_order and o.live_mode=p_live_mode;
  return v_result;
end $$;

commit;

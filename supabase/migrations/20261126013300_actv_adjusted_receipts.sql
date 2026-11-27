begin;

-- Read participant/event facts from the registration snapshot and explicit
-- audited corrections. Financial eligibility remains the same ledger contract.
create or replace function public.actv_sale_receipt(
  p_order_id uuid default null,p_registration_id uuid default null,
  p_event_id uuid default null,p_folio text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_registration public.inscripciones;
  v_order actv_payments.orders;
  v_event public.eventos;
  v_capture actv_payments.captures;
  v_rows jsonb;
  v_cashier text;
  v_event_snapshot jsonb;
  v_financial jsonb;
  v_lifecycle jsonb;
  v_adjusted boolean;
begin
  if auth.uid() is null or actv_payments.role(auth.uid()) is null then
    raise exception 'Acceso de personal requerido' using errcode='42501';
  end if;
  if p_order_id is not null then
    if p_registration_id is not null or p_event_id is not null or p_folio is not null then
      raise exception 'Usa una sola identidad de recibo' using errcode='22023';
    end if;
    select * into v_order from actv_payments.orders where id=p_order_id;
    if not found then raise exception 'Recibo no disponible' using errcode='42501'; end if;
  else
    if p_registration_id is not null then
      if p_event_id is not null or p_folio is not null then
        raise exception 'Usa una sola identidad de recibo' using errcode='22023';
      end if;
      select * into v_registration from public.inscripciones where id=p_registration_id;
    elsif p_event_id is not null and nullif(btrim(p_folio),'') is not null then
      -- A folio is meaningful only within its event. Never select a random last sale.
      if (select count(*) from public.inscripciones where evento_id=p_event_id
          and folio_asignado=upper(btrim(p_folio)))<>1 then
        raise exception 'Recibo no disponible o folio ambiguo' using errcode='42501';
      end if;
      select * into v_registration from public.inscripciones where evento_id=p_event_id
        and folio_asignado=upper(btrim(p_folio));
    else
      raise exception 'Selecciona orden, inscripción o evento y folio' using errcode='22023';
    end if;
    if v_registration.id is null or not actv_payments.can_sell(auth.uid(),v_registration.evento_id) then
      raise exception 'Recibo no disponible' using errcode='42501';
    end if;
    if v_registration.actv_order_item_id is not null then
      select o.* into v_order from actv_payments.orders o join actv_payments.items i on i.order_id=o.id
        where i.id=v_registration.actv_order_item_id;
    end if;
  end if;
  if v_order.id is not null then
    if not actv_payments.can_sell(auth.uid(),v_order.event_id) then
      raise exception 'Recibo no disponible' using errcode='42501';
    end if;
    select * into v_capture from actv_payments.captures where order_id=v_order.id;
    if v_order.state not in ('issued','review','voided') or v_capture.order_id is null or v_capture.amount<>v_order.amount
      or v_capture.currency<>v_order.currency or
      (select count(*) from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
        where i.order_id=v_order.id and r.folio_asignado is not null)<>v_order.item_count then
      raise exception 'Pago o folios no vigentes; consulta conciliación' using errcode='42501';
    end if;
    v_financial:=actv_payments.financial_order_state(v_order.id);
    v_lifecycle:=actv_payments.lifecycle(v_order.event_id);
    v_adjusted:=v_order.state<>'issued' or (v_financial->>'refunded')::bigint>0 or (v_financial->>'hold')::boolean or v_lifecycle->>'phase'='cancelled';
    select * into v_event from public.eventos where id=v_order.event_id;
    select s.effective->'event' into v_event_snapshot from actv_payments.items i
      join public.inscripciones r on r.actv_order_item_id=i.id
      join actv_payments.registration_snapshots s on s.registration_id=r.id
      where i.order_id=v_order.id order by i.number limit 1;
    select nombre_completo into v_cashier from public.perfiles where id=v_order.operator;
    select jsonb_agg(jsonb_build_object('registration_id',r.id,'athlete_id',r.atleta_id,
      'folio',r.folio_asignado,'package',r.paquete_comprado,'amount_minor',i.amount,
      'name',s.effective#>>'{participant,nombre}','surname',s.effective#>>'{participant,apellido}',
      'phone',s.effective#>>'{participant,telefono}','shirt_size',s.effective#>>'{participant,talla_playera}',
      'club',s.effective#>>'{participant,club}','revision',s.revision,'provenance',s.provenance,
      'entry_allowed',actv_payments.registration_entry_allowed(r.id),
      'refunded_minor',(select f.refunded_minor from actv_payments.financial_item_state(v_order.id) f where f.item_id=i.id)) order by i.number)
      into v_rows from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
      join actv_payments.registration_snapshots s on s.registration_id=r.id where i.order_id=v_order.id;
    return jsonb_build_object('receipt_id',v_order.id,'order_id',v_order.id,'event_id',v_event.id,
      'event_name',v_event_snapshot->>'name','event_date',v_event_snapshot->>'date','issued_at',v_capture.captured_at,
      'payment_status',case when v_adjusted then 'adjusted' else 'confirmed' end,'amount_minor',v_capture.amount,'currency',v_capture.currency,
      'refunded_minor',(v_financial->>'refunded')::bigint,'pending_minor',(v_financial->>'pending')::bigint,
      'net_minor',greatest(0,v_capture.amount-(v_financial->>'refunded')::bigint),'financial_hold',(v_financial->>'hold')::boolean,
      'event_status',v_lifecycle->>'phase',
      'channel',v_order.channel,'cashier_id',v_order.operator,'cashier_name',v_cashier,'participants',v_rows);
  end if;
  if v_registration.actv_eligible is not null or v_registration.monto_pagado::text='WP / Online'
    or v_registration.folio_asignado is null then
    raise exception 'No hay recibo histórico verificable' using errcode='42501';
  end if;
  select * into v_event from public.eventos where id=v_registration.evento_id;
  select nombre_completo into v_cashier from public.perfiles where id=v_registration.usuario_id;
  select s.effective->'event' into v_event_snapshot from actv_payments.registration_snapshots s where s.registration_id=v_registration.id;
  select jsonb_build_array(jsonb_build_object('registration_id',v_registration.id,'athlete_id',v_registration.atleta_id,
    'folio',v_registration.folio_asignado,'package',v_registration.paquete_comprado,'amount_minor',null,
    'name',s.effective#>>'{participant,nombre}','surname',s.effective#>>'{participant,apellido}',
    'phone',s.effective#>>'{participant,telefono}','shirt_size',s.effective#>>'{participant,talla_playera}',
    'club',s.effective#>>'{participant,club}','revision',s.revision,'provenance',s.provenance))
    into v_rows from actv_payments.registration_snapshots s where s.registration_id=v_registration.id;
  return jsonb_build_object('receipt_id',v_registration.id,'order_id',null,'event_id',v_event.id,
    'event_name',v_event_snapshot->>'name','event_date',v_event_snapshot->>'date','issued_at',v_registration.created_at,
    'payment_status','payment_unverified','amount_minor',null,'recorded_amount',v_registration.monto_pagado,
    'currency','mxn','channel',v_registration.metodo_pago,'cashier_id',v_registration.usuario_id,
    'cashier_name',v_cashier,'participants',v_rows);
end $$;
revoke all on function public.actv_sale_receipt(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.actv_sale_receipt(uuid,uuid,uuid,text) to authenticated;
commit;

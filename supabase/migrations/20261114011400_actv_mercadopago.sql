begin;

create table actv_payments.mercadopago_accounts (
  organizer_id uuid not null references actv_payments.organizers,
  live_mode boolean not null,
  collector_id text not null check (collector_id ~ '^[1-9][0-9]{0,19}$'),
  ready boolean not null default false,
  primary key (organizer_id,live_mode),
  unique (collector_id,live_mode),
  unique (organizer_id,live_mode,collector_id)
);

alter table actv_payments.events add column mercadopago_enabled boolean not null default false;

alter table actv_payments.orders
  add column payment_provider text not null default 'stripe',
  add column mercadopago_collector_id text,
  add column mercadopago_preference_id text,
  add column mercadopago_claim_id uuid,
  add column mercadopago_payment_id text,
  add column mercadopago_refunded bigint not null default 0,
  add column mercadopago_disputed boolean not null default false;
update actv_payments.orders set payment_provider='cash' where channel='cash';
-- Replace the original equivalence between cash and a missing Stripe account.
alter table actv_payments.orders drop constraint orders_check,
  add constraint actv_order_payment_provider check (
    (payment_provider='cash' and channel='cash' and account_id is null)
    or (payment_provider='stripe' and channel in ('online','terminal') and account_id is not null)
    or (payment_provider='mercadopago' and channel='online' and account_id is null
      and provider_session_id is null and provider_payment_id is null)
  ),
  add constraint actv_order_mercadopago_account
    foreign key (organizer_id,live_mode,mercadopago_collector_id)
    references actv_payments.mercadopago_accounts(organizer_id,live_mode,collector_id),
  add constraint actv_order_mercadopago_fields check (
    (payment_provider='mercadopago')=(mercadopago_collector_id is not null)
    and (mercadopago_preference_id is null or (
      mercadopago_preference_id ~ '^[1-9][0-9]{0,19}-[A-Za-z0-9_-]{1,150}$'
      and split_part(mercadopago_preference_id,'-',1)=mercadopago_collector_id
      and mercadopago_claim_id is not null))
    and (mercadopago_claim_id is null or payment_provider='mercadopago')
    and (mercadopago_payment_id is null or (
      mercadopago_payment_id ~ '^[1-9][0-9]{0,19}$' and mercadopago_preference_id is not null))
    and mercadopago_refunded between 0 and amount
    and ((mercadopago_refunded=0 and not mercadopago_disputed) or mercadopago_payment_id is not null)
  );
create unique index actv_order_mp_preference on actv_payments.orders(live_mode,mercadopago_preference_id)
  where mercadopago_preference_id is not null;
create unique index actv_order_mp_payment on actv_payments.orders(live_mode,mercadopago_payment_id)
  where mercadopago_payment_id is not null;

create table actv_payments.mercadopago_refund_movements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references actv_payments.orders,
  amount bigint not null check (amount>0),
  recorded_at timestamptz not null default now(),
  cumulative_amount bigint not null check (cumulative_amount>=amount),
  unique (order_id,cumulative_amount)
);

create function actv_payments.guard_order_provider()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.payment_provider,new.account_id,new.mercadopago_collector_id,new.live_mode)
      is distinct from (old.payment_provider,old.account_id,old.mercadopago_collector_id,old.live_mode)
    or (old.mercadopago_claim_id is not null and new.mercadopago_claim_id is distinct from old.mercadopago_claim_id)
    or (old.mercadopago_preference_id is not null
      and new.mercadopago_preference_id is distinct from old.mercadopago_preference_id)
    or (old.mercadopago_payment_id is not null and new.mercadopago_payment_id is distinct from old.mercadopago_payment_id)
    then raise exception 'El proveedor de pago ya está asignado' using errcode='23514'; end if;
  return new;
end $$;
create trigger actv_guard_order_provider before update on actv_payments.orders
for each row execute function actv_payments.guard_order_provider();

create or replace function actv_payments.order_json(p_order uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'order_id',o.id,'status_token',o.status_token,'channel',o.channel,'state',o.state,
    'amount',o.amount,'currency',o.currency,'account_id',o.account_id,'live_mode',o.live_mode,
    'reader_id',o.reader_id,'expires_at',o.expires_at,'provider_session_id',o.provider_session_id,
    'provider_payment_id',o.provider_payment_id,'event_id',o.event_id,'buyer_email',o.buyer_email,
    'provider',o.payment_provider,'mercadopago_collector_id',o.mercadopago_collector_id,
    'provider_preference_id',o.mercadopago_preference_id,'mercadopago_payment_id',o.mercadopago_payment_id,
    'mercadopago_claim_id',o.mercadopago_claim_id,
    'application_fee_amount',o.application_fee_amount,
    'items',(select jsonb_agg(jsonb_build_object('name',i.name,'amount',i.amount) order by i.number)
             from actv_payments.items i where i.order_id=o.id),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'created_at',r.created_at,'folio_asignado',r.folio_asignado,
        'monto_pagado',r.monto_pagado,'paquete_comprado',r.paquete_comprado) order by i.number)
      from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
      where i.order_id=o.id and o.state='issued' and r.actv_eligible),'[]'::jsonb)
  )
  from actv_payments.orders o where o.id=p_order
$$;

create function actv_payments.create_order(
  p_event_id uuid,p_request_id uuid,p_channel text,p_items jsonb,p_operator uuid,
  p_relay boolean,p_buyer_email text,p_live_mode boolean,p_provider text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.eventos;
  v_config actv_payments.events;
  v_account actv_payments.accounts;
  v_collector text;
  v_existing actv_payments.orders;
  v_order uuid;
  v_item jsonb;
  v_count integer;
  v_number integer:=0;
  v_price numeric;
  v_name text;
  v_amount bigint;
  v_total bigint:=0;
  v_athlete uuid;
  v_items jsonb:='[]';
begin
  if p_request_id is null or p_event_id is null or p_channel is null
    or p_channel not in ('online','cash','terminal') or jsonb_typeof(p_items) is distinct from 'array'
    or p_relay is null then raise exception 'Pedido inválido'; end if;
  v_count:=jsonb_array_length(p_items);
  if v_count not between 1 and 20 or (p_relay and v_count<2) then raise exception 'Cantidad inválida'; end if;
  if p_channel='online' then
    if p_operator is not null or p_buyer_email is null or length(p_buyer_email)>250
      or p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Correo inválido';
    end if;
  elsif not actv_payments.can_sell(p_operator,p_event_id) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  -- A retry with the same request cannot reserve a different basket or disclose another order.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
  select * into v_existing from actv_payments.orders where request_id=p_request_id;
  if found then
    if v_existing.payment_provider is distinct from p_provider then
      raise exception 'La solicitud ya tiene otro proveedor de pago' using errcode='23514';
    end if;
    if v_existing.event_id<>p_event_id or v_existing.channel<>p_channel
       or v_existing.operator is distinct from p_operator or v_existing.original_items<>p_items
       or v_existing.relay<>p_relay or v_existing.buyer_email is distinct from lower(p_buyer_email)
       or (p_live_mode is not null and v_existing.live_mode<>p_live_mode) then
      raise exception 'La solicitud ya pertenece a otro pedido';
    end if;
    return actv_payments.order_json(v_existing.id);
  end if;
  select * into v_event from public.eventos where id=p_event_id for update;
  if not found or v_event.activo is distinct from true or v_event.cupo_maximo is null or v_event.cupo_maximo<1
    or v_event.fecha < (now() at time zone 'America/Matamoros')::date then
    raise exception 'Evento no disponible';
  end if;
  if p_channel='cash' then
    insert into actv_payments.events(event_id,organizer_id)
    values(p_event_id,'00000000-0000-4000-8000-000000000ac7') on conflict do nothing;
  end if;
  select * into v_config from actv_payments.events where event_id=p_event_id;
  if not found then raise exception 'Evento no configurado'; end if;
  if p_live_mode is not null and v_config.live_mode<>p_live_mode then
    raise exception 'Modo de pago no disponible';
  end if;
  if p_provider='mercadopago' then
    select collector_id into v_collector from actv_payments.mercadopago_accounts
      where organizer_id=v_config.organizer_id and live_mode=v_config.live_mode and ready;
    if not found or not v_config.mercadopago_enabled then raise exception 'Canal no disponible'; end if;
  elsif p_channel<>'cash' then
    select * into v_account from actv_payments.accounts
    where organizer_id=v_config.organizer_id and live_mode=v_config.live_mode and ready;
    if not found or (p_channel='online' and not v_config.online_enabled)
      or (p_channel='terminal' and v_config.reader_id is null) then raise exception 'Canal no disponible'; end if;
  end if;
  if actv_payments.used(p_event_id)+v_count>v_event.cupo_maximo then raise exception 'Cupo agotado'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_number:=v_number+1;
    case v_item->>'package'
      when '1' then v_price:=v_event.precio_1; v_name:=v_event.nombre_precio_1;
      when '2' then v_price:=v_event.precio_2; v_name:=v_event.nombre_precio_2;
      else raise exception 'Paquete inválido';
    end case;
    if v_price is null or v_price<=0 or (p_channel<>'cash' and v_price<10)
      or v_price>999999.99 or v_price*100<>trunc(v_price*100)
      or nullif(trim(v_name),'') is null then raise exception 'Precio no disponible'; end if;
    v_amount:=(v_price*100)::bigint;
    if p_channel='online' then
      if length(trim(coalesce(v_item->>'nombre',''))) not between 1 and 100
        or length(trim(coalesce(v_item->>'apellido',''))) not between 1 and 100
        or length(trim(coalesce(v_item->>'telefono',''))) not between 7 and 30
        or length(trim(coalesce(v_item->>'telefono_emergencia',''))) not between 7 and 30
        or length(trim(coalesce(v_item->>'talla_playera',''))) not between 1 and 30 then
        raise exception 'Datos del participante inválidos';
      end if;
      v_athlete:=null;
    else
      v_athlete:=(v_item->>'athlete_id')::uuid;
      if v_athlete is null or not exists(select 1 from public.atletas where id=v_athlete) then
        raise exception 'Atleta no disponible';
      end if;
      if exists (select 1 from public.inscripciones
        where evento_id=p_event_id and atleta_id=v_athlete and actv_eligible is distinct from false)
        or exists (select 1 from actv_payments.items i join actv_payments.orders o on o.id=i.order_id
          where i.athlete_id=v_athlete and o.event_id=p_event_id and o.state='pending' and o.expires_at>now())
        or exists(select 1 from jsonb_array_elements(v_items) x where x->>'athlete_id'=v_athlete::text) then
        raise exception 'Atleta ya inscrito en esta carrera';
      end if;
    end if;
    v_total:=v_total+v_amount;
    v_items:=v_items || jsonb_build_array(jsonb_build_object(
      'number',v_number,'athlete_id',v_athlete,'name',v_name,'amount',v_amount,
      'participant',case when p_channel='online' then jsonb_build_object(
        'nombre',trim(v_item->>'nombre'),'apellido',trim(v_item->>'apellido'),
        'telefono',trim(v_item->>'telefono'),'telefono_emergencia',trim(v_item->>'telefono_emergencia'),
        'talla_playera',trim(v_item->>'talla_playera')) end));
  end loop;
  insert into actv_payments.orders(event_id,organizer_id,request_id,channel,operator,buyer_email,relay,
    item_count,original_items,amount,account_id,live_mode,payment_provider,mercadopago_collector_id,reader_id,expires_at)
  values(p_event_id,v_config.organizer_id,p_request_id,p_channel,p_operator,lower(p_buyer_email),p_relay,
    v_count,p_items,v_total,v_account.account_id,v_config.live_mode,p_provider,v_collector,
    case when p_channel='terminal' then v_config.reader_id end,
    now()+case when p_channel='online' then interval '45 minutes' else interval '15 minutes' end)
  returning id into v_order;
  insert into actv_payments.items(order_id,number,athlete_id,participant,name,amount)
    select v_order,i.number,i.athlete_id,i.participant,i.name,i.amount
    from jsonb_to_recordset(v_items) i(number integer,athlete_id uuid,participant jsonb,name text,amount bigint);
  return actv_payments.order_json(v_order);
end $$;

create or replace function public.actv_create_order(
  p_event_id uuid,p_request_id uuid,p_channel text,p_items jsonb,p_operator uuid default null,
  p_relay boolean default false,p_buyer_email text default null,p_live_mode boolean default null
) returns jsonb language sql security definer set search_path='' as $$
  select actv_payments.create_order(p_event_id,p_request_id,p_channel,p_items,p_operator,p_relay,p_buyer_email,
    p_live_mode,case when p_channel='cash' then 'cash' else 'stripe' end)
$$;

create function public.actv_create_mercadopago_order(
  p_event_id uuid,p_request_id uuid,p_items jsonb,p_buyer_email text,p_live_mode boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_live_mode is null then raise exception 'Modo de pago requerido' using errcode='22023'; end if;
  return actv_payments.create_order(p_event_id,p_request_id,'online',p_items,null,false,p_buyer_email,
    p_live_mode,'mercadopago');
end $$;

create function public.actv_claim_mercadopago_preference(p_order_id uuid,p_live_mode boolean,p_collector_id text)
returns uuid language sql security definer set search_path='' as $$
  update actv_payments.orders
    set mercadopago_claim_id=gen_random_uuid()
    where id=p_order_id and live_mode=p_live_mode and payment_provider='mercadopago'
      and mercadopago_collector_id=p_collector_id and state='pending' and expires_at>now()
      and mercadopago_claim_id is null and mercadopago_preference_id is null
    returning mercadopago_claim_id
$$;

create function public.actv_attach_mercadopago_preference(
  p_order_id uuid,p_live_mode boolean,p_collector_id text,p_preference_id text,p_claim_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_preference_id is null or p_preference_id !~ '^[1-9][0-9]{0,19}-[A-Za-z0-9_-]{1,150}$'
    or split_part(p_preference_id,'-',1) is distinct from p_collector_id then
    raise exception 'Referencia de Mercado Pago inválida' using errcode='22023'; end if;
  update actv_payments.orders set mercadopago_preference_id=p_preference_id
    where id=p_order_id and live_mode=p_live_mode and payment_provider='mercadopago'
      and mercadopago_collector_id=p_collector_id and mercadopago_claim_id=p_claim_id
      and (mercadopago_preference_id is null or mercadopago_preference_id=p_preference_id);
  if not found then raise exception 'Referencia de Mercado Pago incompatible' using errcode='23514'; end if;
  return actv_payments.order_json(p_order_id);
end $$;

create function public.actv_confirm_mercadopago(
  p_order_id uuid,p_live_mode boolean,p_collector_id text,p_preference_id text,p_payment_id text,
  p_amount bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order actv_payments.orders;
  v_capture actv_payments.captures;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if v_order.payment_provider<>'mercadopago' or p_live_mode is distinct from v_order.live_mode
    or p_collector_id is distinct from v_order.mercadopago_collector_id
    or p_preference_id is null or p_preference_id is distinct from v_order.mercadopago_preference_id
    or p_payment_id is null or p_payment_id !~ '^[1-9][0-9]{0,19}$'
    or p_amount is distinct from v_order.amount or lower(p_currency) is distinct from v_order.currency
    or (v_order.mercadopago_payment_id is not null and v_order.mercadopago_payment_id<>p_payment_id) then
    raise exception 'El pago de Mercado Pago no coincide con el pedido' using errcode='23514'; end if;
  update actv_payments.orders set mercadopago_payment_id=p_payment_id where id=p_order_id;
  insert into actv_payments.captures(order_id,live_mode,provider_payment_id,amount,currency)
    values(p_order_id,p_live_mode,p_payment_id,p_amount,lower(p_currency)) on conflict(order_id) do nothing;
  select * into strict v_capture from actv_payments.captures where order_id=p_order_id;
  if (v_capture.account_id,v_capture.live_mode,v_capture.provider_payment_id,v_capture.amount,v_capture.currency)
     is distinct from (null::text,p_live_mode,p_payment_id,p_amount,lower(p_currency)) then
    raise exception 'Pago duplicado o incompatible' using errcode='23514'; end if;
  return actv_payments.issue(p_order_id);
end $$;

create function public.actv_record_mercadopago_reversal(
  p_order_id uuid,p_live_mode boolean,p_collector_id text,p_preference_id text,p_payment_id text,
  p_state text,p_refunded_amount bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order actv_payments.orders;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if v_order.payment_provider<>'mercadopago' or p_live_mode is distinct from v_order.live_mode
    or p_collector_id is distinct from v_order.mercadopago_collector_id
    or p_preference_id is null or p_preference_id is distinct from v_order.mercadopago_preference_id
    or p_payment_id is null or p_payment_id !~ '^[1-9][0-9]{0,19}$'
    or (v_order.mercadopago_payment_id is not null and v_order.mercadopago_payment_id<>p_payment_id)
    or p_state is null or p_state not in ('approved','refunded','charged_back')
    or p_refunded_amount is null or p_refunded_amount not between 0 and v_order.amount
    or (p_state='refunded' and p_refunded_amount<>v_order.amount)
    or (p_state='approved' and p_refunded_amount=0) then
    raise exception 'La reversión de Mercado Pago no coincide con el pedido' using errcode='23514'; end if;
  if p_refunded_amount>v_order.mercadopago_refunded then
    insert into actv_payments.mercadopago_refund_movements(order_id,amount,cumulative_amount)
      values(p_order_id,p_refunded_amount-v_order.mercadopago_refunded,p_refunded_amount);
  end if;
  update actv_payments.orders set mercadopago_payment_id=p_payment_id,
    mercadopago_refunded=greatest(mercadopago_refunded,p_refunded_amount),
    mercadopago_disputed=mercadopago_disputed or p_state='charged_back',
    state=case when greatest(mercadopago_refunded,p_refunded_amount)>=amount then 'voided' else 'review' end
    where id=p_order_id;
  -- A refund/chargeback can arrive before the approval notification. The Edge
  -- function has verified the exact original captured amount in this case too.
  insert into actv_payments.captures(order_id,live_mode,provider_payment_id,amount,currency)
    values(p_order_id,p_live_mode,p_payment_id,v_order.amount,v_order.currency)
    on conflict(order_id) do nothing;
  if not exists(select from actv_payments.captures c where c.order_id=p_order_id and c.account_id is null
    and (c.live_mode,c.provider_payment_id,c.amount,c.currency)=
      (p_live_mode,p_payment_id,v_order.amount,v_order.currency)) then
    raise exception 'Pago duplicado o incompatible' using errcode='23514'; end if;
  update public.inscripciones r set actv_eligible=false
    from actv_payments.items i where i.order_id=p_order_id and r.actv_order_item_id=i.id and r.actv_eligible;
  return actv_payments.order_json(p_order_id);
end $$;

create or replace function public.actv_attach_provider(p_order_id uuid,p_account_id text,p_live_mode boolean,
  p_session_id text default null,p_payment_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order actv_payments.orders;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if v_order.payment_provider<>'stripe' or v_order.account_id is distinct from p_account_id
    or v_order.live_mode is distinct from p_live_mode
    or (p_session_id is not null and (v_order.channel<>'online' or p_session_id !~ '^cs_[A-Za-z0-9_]+$'))
    or (p_payment_id is not null and p_payment_id !~ '^pi_[A-Za-z0-9_]+$')
    or (p_session_id is not null and v_order.provider_session_id is not null and p_session_id<>v_order.provider_session_id)
    or (p_payment_id is not null and v_order.provider_payment_id is not null and p_payment_id<>v_order.provider_payment_id) then
    raise exception 'Referencia de Stripe incompatible';
  end if;
  if v_order.channel='terminal' and v_order.state<>'pending'
    and v_order.provider_payment_id is distinct from p_payment_id then
    raise exception 'El pedido de terminal está cerrado';
  end if;
  if v_order.state='pending' or v_order.provider_session_id is null or v_order.provider_payment_id is null then
    update actv_payments.orders set provider_session_id=coalesce(provider_session_id,p_session_id),
      provider_payment_id=coalesce(provider_payment_id,p_payment_id) where id=p_order_id;
  end if;
  return actv_payments.order_json(p_order_id);
end $$;
create or replace function actv_payments.refresh_eligibility(p_order uuid) returns boolean
language plpgsql set search_path='' as $$
declare
  v_capture actv_payments.captures;
  v_refunded bigint;
  v_dispute boolean;
  v_ok boolean;
begin
  select * into v_capture from actv_payments.captures where order_id=p_order;
  if not found then return false; end if;
  select mercadopago_refunded,mercadopago_disputed into v_refunded,v_dispute
    from actv_payments.orders where id=p_order;
  if v_capture.account_id is not null then
    select coalesce(sum(amount) filter(where kind='refund' and state='succeeded'),0),
           coalesce(bool_or(kind='dispute' and state not in ('won','warning_closed','warning_needs_response','warning_under_review')),false)
    into v_refunded,v_dispute from actv_payments.adjustments
    where account_id=v_capture.account_id and live_mode=v_capture.live_mode and payment_id=v_capture.provider_payment_id;
  end if;
  v_ok:=v_refunded=0 and not v_dispute;
  update public.inscripciones r set actv_eligible=v_ok
    from actv_payments.items i where i.order_id=p_order and r.actv_order_item_id=i.id
      and r.actv_eligible is distinct from v_ok;
  if not v_ok then
    update actv_payments.orders
    set state=case when v_refunded>=v_capture.amount then 'voided' else 'review' end where id=p_order;
  elsif exists(select 1 from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
               where i.order_id=p_order) then
    update actv_payments.orders set state='issued' where id=p_order;
  end if;
  return v_ok;
end $$;
create or replace function public.actv_catalog(p_event_id uuid default null,p_slug text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',e.id,'event_id',e.id,'slug',coalesce(c.slug,e.id::text),
    'name',e.nombre_carrera,'date',e.fecha,'description',e.descripcion,'currency','mxn',
    'payment_providers',array_remove(array[
      case when c.online_enabled and a.ready then 'stripe' end,
      case when c.mercadopago_enabled and m.ready then 'mercadopago' end],null),
    'available',greatest(0,e.cupo_maximo-actv_payments.used(e.id)),'options',p.options,'packages',p.options)
  from public.eventos e join actv_payments.events c on e.id=c.event_id
  left join actv_payments.accounts a on a.organizer_id=c.organizer_id and a.live_mode=c.live_mode
  left join actv_payments.mercadopago_accounts m on m.organizer_id=c.organizer_id and m.live_mode=c.live_mode
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id',n,'package',n,'name',label,'amount',(price*100)::bigint,
      'amountMinor',(price*100)::bigint,'currency','mxn') order by n) as options
    from (values (1,e.nombre_precio_1,e.precio_1),(2,e.nombre_precio_2,e.precio_2)) x(n,label,price)
    where label is not null and price between 10 and 999999.99 and price*100=trunc(price*100)
      and (not c.live_commission_enabled or price > 15)
  ) p
  where ((p_event_id is not null and e.id=p_event_id)
    or (p_event_id is null and (c.slug=p_slug or e.id::text=p_slug)))
    and e.activo and e.fecha >= (now() at time zone 'America/Matamoros')::date
    and ((c.online_enabled and a.ready) or (c.mercadopago_enabled and m.ready)) and p.options is not null
  order by (c.slug=p_slug) desc nulls last limit 1
$$;

revoke all on function actv_payments.guard_order_provider(),
  actv_payments.create_order(uuid,uuid,text,jsonb,uuid,boolean,text,boolean,text),
  public.actv_create_mercadopago_order(uuid,uuid,jsonb,text,boolean),
  public.actv_claim_mercadopago_preference(uuid,boolean,text),
  public.actv_attach_mercadopago_preference(uuid,boolean,text,text,uuid),
  public.actv_confirm_mercadopago(uuid,boolean,text,text,text,bigint,text),
  public.actv_record_mercadopago_reversal(uuid,boolean,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.actv_create_mercadopago_order(uuid,uuid,jsonb,text,boolean),
  public.actv_claim_mercadopago_preference(uuid,boolean,text),
  public.actv_attach_mercadopago_preference(uuid,boolean,text,text,uuid),
  public.actv_confirm_mercadopago(uuid,boolean,text,text,text,bigint,text),
  public.actv_record_mercadopago_reversal(uuid,boolean,text,text,text,text,bigint) to service_role;

commit;

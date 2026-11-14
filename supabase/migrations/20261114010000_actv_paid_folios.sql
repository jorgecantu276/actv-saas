begin;

create schema actv_payments;
revoke all on schema actv_payments from public, anon, authenticated;

create table actv_payments.organizers (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
create table actv_payments.members (
  organizer_id uuid references actv_payments.organizers on delete cascade,
  user_id uuid references public.perfiles on delete cascade,
  primary key (organizer_id, user_id)
);
create table actv_payments.staff (
  user_id uuid primary key references public.perfiles,
  role text not null check (role in ('manager','cashier')),
  all_events boolean not null default false
);
create table actv_payments.staff_events (
  user_id uuid references actv_payments.staff(user_id) on delete cascade,
  event_id uuid references public.eventos,
  primary key (user_id,event_id)
);
create table actv_payments.accounts (
  organizer_id uuid references actv_payments.organizers,
  live_mode boolean,
  account_id text not null check (account_id ~ '^acct_[A-Za-z0-9]+$'),
  ready boolean not null default false,
  primary key (organizer_id, live_mode),
  unique (account_id, live_mode)
);
create table actv_payments.events (
  event_id uuid primary key references public.eventos,
  organizer_id uuid not null references actv_payments.organizers,
  live_mode boolean not null default false,
  online_enabled boolean not null default false,
  reader_id text check (reader_id ~ '^tmr_[A-Za-z0-9]+$'),
  slug text unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  next_folio bigint
);
create table actv_payments.shifts (
  id uuid primary key default gen_random_uuid(),
  operator uuid not null references public.perfiles,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening bigint not null check (opening >= 0),
  expected bigint,
  counted bigint check (counted >= 0),
  deposit_reference text unique,
  deposit_amount bigint check (deposit_amount >= 0),
  deposited_by uuid references public.perfiles,
  deposited_at timestamptz
);
create unique index actv_open_shift_per_cashier on actv_payments.shifts(operator) where closed_at is null;
create table actv_payments.orders (
  id uuid primary key default gen_random_uuid(),
  status_token uuid not null unique default gen_random_uuid(),
  event_id uuid not null references actv_payments.events,
  organizer_id uuid not null references actv_payments.organizers,
  request_id uuid not null unique,
  channel text not null check (channel in ('cash','online','terminal')),
  state text not null default 'pending' check (state in ('pending','issued','closed','review','voided')),
  operator uuid references public.perfiles,
  buyer_email text,
  relay boolean not null,
  item_count integer not null check (item_count between 1 and 20),
  original_items jsonb not null,
  amount bigint not null check (amount > 0),
  currency text not null default 'mxn' check (currency = 'mxn'),
  account_id text,
  live_mode boolean not null,
  reader_id text,
  provider_session_id text,
  provider_payment_id text,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  expires_at timestamptz not null,
  foreign key (account_id, live_mode) references actv_payments.accounts(account_id, live_mode),
  check ((channel = 'cash') = (account_id is null)),
  check ((channel = 'online') = (operator is null))
);
create unique index actv_order_session on actv_payments.orders(account_id,live_mode,provider_session_id) where provider_session_id is not null;
create unique index actv_order_intent on actv_payments.orders(account_id,live_mode,provider_payment_id) where provider_payment_id is not null;
create unique index actv_one_pending_reader on actv_payments.orders(account_id,live_mode,reader_id)
  where channel='terminal' and state='pending';
create index actv_orders_holds on actv_payments.orders(event_id, expires_at) where state = 'pending';
create table actv_payments.items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references actv_payments.orders,
  number integer not null,
  athlete_id uuid references public.atletas,
  participant jsonb,
  name text not null,
  amount bigint not null check (amount > 0),
  unique(order_id, number)
);
create table actv_payments.captures (
  order_id uuid primary key references actv_payments.orders,
  captured_at timestamptz not null default now(),
  account_id text,
  live_mode boolean not null,
  provider_payment_id text,
  charge_id text,
  shift_id uuid references actv_payments.shifts,
  tendered bigint,
  amount bigint not null check (amount > 0),
  currency text not null check (currency = 'mxn'),
  check ((shift_id is null) <> (provider_payment_id is null)),
  check (shift_id is null or tendered >= amount),
  unique(account_id,live_mode,provider_payment_id),
  unique(account_id,live_mode,charge_id)
);
create index actv_capture_shift on actv_payments.captures(shift_id) where shift_id is not null;
create index actv_captures_date on actv_payments.captures(captured_at);
create table actv_payments.provider_events (
  account_id text,
  live_mode boolean,
  event_id text,
  type text not null,
  object_id text not null,
  order_id uuid,
  received_at timestamptz not null default now(),
  retry_after timestamptz not null default now(),
  attempts integer not null default 0,
  failure_code text,
  processed_at timestamptz,
  primary key(account_id,live_mode,event_id)
);
create index actv_pending_provider_events on actv_payments.provider_events(live_mode, retry_after, received_at) where processed_at is null;
create table actv_payments.adjustments (
  account_id text,
  live_mode boolean,
  reference text,
  kind text not null check (kind in ('refund','dispute')),
  payment_id text not null,
  amount bigint not null check (amount > 0),
  currency text not null check (currency = 'mxn'),
  state text not null,
  recorded_at timestamptz not null default now(),
  primary key(account_id, live_mode, reference)
);
create index actv_adjustment_payment on actv_payments.adjustments(account_id,live_mode,payment_id);
create table actv_payments.settlements (
  account_id text,
  live_mode boolean,
  payout_id text,
  amount bigint not null,
  currency text not null check (currency = 'mxn'),
  state text not null,
  recorded_at timestamptz not null default now(),
  bank_reference text unique,
  bank_amount bigint,
  bank_matched_by uuid references public.perfiles,
  bank_matched_at timestamptz,
  primary key(account_id,live_mode,payout_id)
);
create table actv_payments.settlement_lines (
  account_id text,
  live_mode boolean,
  payout_id text,
  id text,
  source text,
  amount bigint not null,
  fee bigint not null,
  net bigint not null,
  currency text not null,
  primary key(account_id,live_mode,id),
  foreign key(account_id,live_mode,payout_id) references actv_payments.settlements,
  check (amount - fee = net)
);

alter table public.inscripciones
  add column actv_order_item_id uuid unique references actv_payments.items,
  add column actv_eligible boolean;
create index actv_registrations_event_athlete on public.inscripciones(evento_id,atleta_id);

-- Existing events stay cash-only until an explicit organizer assignment.
insert into actv_payments.organizers (id,name) values ('00000000-0000-4000-8000-000000000ac7','ACTV');

create function actv_payments.role(p_user uuid) returns text
language sql stable set search_path = '' as $$
  select role from actv_payments.staff where user_id=p_user
$$;
create function actv_payments.is_manager(p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(actv_payments.role(p_user)='manager',false)
$$;
create function actv_payments.can_sell(p_user uuid,p_event uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from actv_payments.staff s
    where s.user_id=p_user and (
      s.role='manager' or s.all_events or exists(select 1 from actv_payments.staff_events a
        where a.user_id=p_user and a.event_id=p_event)
    )
  )
$$;
create function actv_payments.can_manage(p_user uuid,p_organizer uuid) returns boolean
language sql stable set search_path = '' as $$
  select actv_payments.is_manager(p_user) or exists (
    select 1 from actv_payments.members where organizer_id=p_organizer and user_id=p_user
  )
$$;
create function actv_payments.used(p_event uuid,p_exclude uuid default null) returns bigint
language sql stable set search_path = '' as $$
  select
    (select count(*) from public.inscripciones where evento_id=p_event)
    + (select coalesce(sum(item_count),0) from actv_payments.orders
       where event_id=p_event and state='pending' and expires_at>now() and id is distinct from p_exclude)
$$;
create function actv_payments.order_json(p_order uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'order_id',o.id,'status_token',o.status_token,'channel',o.channel,'state',o.state,
    'amount',o.amount,'currency',o.currency,'account_id',o.account_id,'live_mode',o.live_mode,
    'reader_id',o.reader_id,'expires_at',o.expires_at,'provider_session_id',o.provider_session_id,
    'provider_payment_id',o.provider_payment_id,'event_id',o.event_id,'buyer_email',o.buyer_email,
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

create function public.actv_create_order(
  p_event_id uuid,p_request_id uuid,p_channel text,p_items jsonb,p_operator uuid default null,
  p_relay boolean default false,p_buyer_email text default null,p_live_mode boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.eventos;
  v_config actv_payments.events;
  v_account actv_payments.accounts;
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
  if p_channel<>'cash' then
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
    item_count,original_items,amount,account_id,live_mode,reader_id,expires_at)
  values(p_event_id,v_config.organizer_id,p_request_id,p_channel,p_operator,lower(p_buyer_email),p_relay,
    v_count,p_items,v_total,v_account.account_id,v_config.live_mode,
    case when p_channel='terminal' then v_config.reader_id end,
    now()+case when p_channel='online' then interval '45 minutes' else interval '15 minutes' end)
  returning id into v_order;
  insert into actv_payments.items(order_id,number,athlete_id,participant,name,amount)
    select v_order,i.number,i.athlete_id,i.participant,i.name,i.amount
    from jsonb_to_recordset(v_items) i(number integer,athlete_id uuid,participant jsonb,name text,amount bigint);
  return actv_payments.order_json(v_order);
end $$;

create function public.actv_order_status(p_order_id uuid,p_status_token uuid default null,p_operator uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1 from actv_payments.orders o where o.id=p_order_id and (
      (p_status_token is not null and o.status_token=p_status_token and o.channel='online')
      or (p_operator is not null and (o.operator=p_operator or actv_payments.is_manager(p_operator)))
    )
  ) then raise exception 'Pedido no disponible' using errcode='42501'; end if;
  return actv_payments.order_json(p_order_id);
end $$;

create function actv_payments.refresh_eligibility(p_order uuid) returns boolean
language plpgsql set search_path='' as $$
declare
  v_capture actv_payments.captures;
  v_refunded bigint;
  v_dispute boolean;
  v_ok boolean;
begin
  select * into v_capture from actv_payments.captures where order_id=p_order;
  if not found then return false; end if;
  select coalesce(sum(amount) filter(where kind='refund' and state='succeeded'),0),
         coalesce(bool_or(kind='dispute' and state not in ('won','warning_closed','warning_needs_response','warning_under_review')),false)
  into v_refunded,v_dispute from actv_payments.adjustments
  where account_id=v_capture.account_id and live_mode=v_capture.live_mode and payment_id=v_capture.provider_payment_id;
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

create function actv_payments.issue(p_order uuid) returns jsonb
language plpgsql set search_path='' as $$
declare
  v_order actv_payments.orders;
  v_event public.eventos;
  v_item actv_payments.items;
  v_next bigint;
  v_base bigint;
  v_folio text;
  v_athlete uuid;
begin
  select * into strict v_order from actv_payments.orders where id=p_order for update;
  if v_order.state='issued' or v_order.state='voided'
    or exists(select 1 from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id where i.order_id=p_order)
  then return actv_payments.order_json(p_order); end if;
  if not actv_payments.refresh_eligibility(p_order) then return actv_payments.order_json(p_order); end if;
  select * into strict v_event from public.eventos where id=v_order.event_id for update;
  if v_event.activo is distinct from true
    or actv_payments.used(v_order.event_id,p_order)+v_order.item_count>coalesce(v_event.cupo_maximo,0)
    or exists(select 1 from actv_payments.items i join public.inscripciones r
     on r.atleta_id=i.athlete_id and r.evento_id=v_order.event_id
     where i.order_id=p_order and r.actv_eligible is distinct from false)
  then
    update actv_payments.orders set state='review' where id=p_order;
    return actv_payments.order_json(p_order);
  end if;
  select next_folio into v_next from actv_payments.events where event_id=v_order.event_id;
  if v_next is null then
    -- Match the legacy relay base. Seed once, then advance the locked counter.
    select greatest(coalesce(v_event.folio_inicial,1),coalesce(max(substring(folio_asignado from '^[0-9]{1,14}')::bigint)+1,1))
    into v_next from public.inscripciones where evento_id=v_order.event_id;
  end if;
  for v_item in select * from actv_payments.items where order_id=p_order order by number loop
    if not v_order.relay or v_item.number=1 then v_base:=v_next; v_next:=v_next+1; end if;
    v_folio:=lpad(v_base::text,greatest(3,length(v_base::text)),'0');
    if v_order.relay then v_folio:=v_folio||'-'||chr(64+v_item.number); end if;
    v_athlete:=v_item.athlete_id;
    if v_athlete is null then
      insert into public.atletas(nombre,apellido,telefono,telefono_emergencia,talla_playera)
      values(v_item.participant->>'nombre',v_item.participant->>'apellido',v_item.participant->>'telefono',
        v_item.participant->>'telefono_emergencia',v_item.participant->>'talla_playera') returning id into v_athlete;
      update actv_payments.items set athlete_id=v_athlete where id=v_item.id;
    end if;
    insert into public.inscripciones(atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago,paquete_comprado,
      usuario_id,actv_order_item_id,actv_eligible)
    values(v_athlete,v_order.event_id,v_folio,v_item.amount::numeric/100,
      case when v_order.channel='cash' then 'efectivo' else 'tarjeta' end,v_item.name,v_order.operator,v_item.id,true);
  end loop;
  update actv_payments.events set next_folio=v_next where event_id=v_order.event_id;
  update actv_payments.orders set state='issued' where id=p_order;
  return actv_payments.order_json(p_order);
end $$;

create function actv_payments.guard_registration() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.actv_eligible is distinct from true or not exists(
      select 1 from actv_payments.items i
      join actv_payments.orders o on o.id=i.order_id
      join actv_payments.captures c on c.order_id=o.id
      where i.id=new.actv_order_item_id and o.event_id=new.evento_id and i.athlete_id=new.atleta_id
        and i.amount=new.monto_pagado*100 and c.amount=o.amount and c.currency=o.currency
    ) then raise exception 'Se requiere un pago confirmado para emitir un folio' using errcode='42501'; end if;
    return new;
  end if;
  if tg_op='DELETE' then raise exception 'Los folios se conservan para conciliación' using errcode='42501'; end if;
  if (new.evento_id,new.atleta_id,new.folio_asignado,new.monto_pagado,new.metodo_pago,new.paquete_comprado,
       new.actv_order_item_id)
     is distinct from
     (old.evento_id,old.atleta_id,old.folio_asignado,old.monto_pagado,old.metodo_pago,old.paquete_comprado,
       old.actv_order_item_id)
    or (new.actv_eligible is distinct from old.actv_eligible and current_user not in ('postgres','supabase_admin'))
  then raise exception 'Los datos de emisión no pueden modificarse' using errcode='42501'; end if;
  if new.kit_entregado is true and new.kit_entregado is distinct from old.kit_entregado
     and new.actv_eligible is false then
    raise exception 'El folio tiene un ajuste pendiente o está anulado';
  end if;
  return new;
end $$;
create trigger actv_paid_folio_gate before insert or update or delete on public.inscripciones
for each row execute function actv_payments.guard_registration();
revoke insert,delete,truncate on public.inscripciones from public,anon,authenticated;

-- Public entry points are granted individually in this migration.
revoke all on all functions in schema actv_payments from public,anon,authenticated;
revoke all on function public.actv_create_order(uuid,uuid,text,jsonb,uuid,boolean,text,boolean)
  from public,anon,authenticated;
revoke all on function public.actv_order_status(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.actv_create_order(uuid,uuid,text,jsonb,uuid,boolean,text,boolean),
  public.actv_order_status(uuid,uuid,uuid) to service_role;
commit;

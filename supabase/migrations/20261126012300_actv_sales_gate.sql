begin;

-- The cutover starts closed. This gate never changes event eligibility or
-- settlement: an accepted payment must still obtain its original folios.
create table actv_payments.sales_control (
  singleton boolean primary key default true check(singleton),
  paused boolean not null default true,
  reason text not null default 'Corte de versión pendiente de autorización',
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);
insert into actv_payments.sales_control(singleton) values(true);
create table actv_payments.sales_control_history (
  id bigint generated always as identity primary key,
  paused boolean not null, reason text not null,
  actor uuid not null references auth.users(id), happened_at timestamptz not null default now()
);
create table actv_payments.provider_attempts (
  order_id uuid not null references actv_payments.orders(id),
  kind text not null check(kind in ('checkout','terminal_intent','terminal_reader')),
  attempt text not null check(length(attempt) between 1 and 100),
  authorized_at timestamptz not null default now(),
  primary key(order_id,kind,attempt)
);
-- Retained orders were accepted before this gate existed. Preserve only their
-- bounded canonical recovery; this records no capture or invented folio.
insert into actv_payments.provider_attempts(order_id,kind,attempt,authorized_at)
select id,case when channel='online' then 'checkout' else 'terminal_intent' end,'canonical',created_at
from actv_payments.orders where state='pending' and payment_provider='stripe'
  and channel in ('online','terminal') and created_at>now()-interval '23 hours';
revoke all on actv_payments.sales_control,actv_payments.sales_control_history,
  actv_payments.provider_attempts from public,anon,authenticated;

create function actv_payments.guard_new_sale() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- SHARE conflicts with the manager UPDATE and is held until order commit.
  perform 1 from actv_payments.sales_control where singleton and not paused for share;
  if not found then raise exception 'Ventas pausadas: consulte la orden existente o contacte al responsable'
    using errcode='P0001'; end if;
  return new;
end $$;
create trigger actv_sales_gate before insert on actv_payments.orders
for each row execute function actv_payments.guard_new_sale();

create function public.actv_sales_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then
    raise exception 'No autorizado' using errcode='42501'; end if;
  return (select jsonb_build_object('paused',paused,'reason',reason,'changed_at',changed_at,
    'can_manage',actv_payments.is_manager(auth.uid())) from actv_payments.sales_control where singleton);
end $$;

create function public.actv_set_sales_pause(p_paused boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  -- Serialize authority changes with staff lifecycle before acquiring gate lock.
  perform pg_advisory_xact_lock(20261126,12100);
  if not actv_payments.is_manager(auth.uid()) then
    raise exception 'No autorizado' using errcode='42501'; end if;
  if p_paused is null or length(trim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Indique el motivo operativo' using errcode='22023'; end if;
  update actv_payments.sales_control set paused=p_paused,reason=trim(p_reason),
    changed_at=clock_timestamp(),changed_by=auth.uid() where singleton;
  insert into actv_payments.sales_control_history(paused,reason,actor)
    values(p_paused,trim(p_reason),auth.uid());
  return public.actv_sales_status();
end $$;

-- An authorization is a durable accepted obligation, not an expiring read of
-- the gate. Pause serializes against its commit. Only that exact canonical
-- provider key may be recovered afterwards; no fresh key bypasses the gate.
create function public.actv_authorize_provider_attempt(p_order_id uuid,p_kind text,p_attempt text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_order actv_payments.orders; v_at timestamptz;
begin
  if p_kind not in ('checkout','terminal_intent','terminal_reader')
    or p_attempt is null or length(p_attempt) not between 1 and 100
    or (p_kind in ('checkout','terminal_intent') and p_attempt<>'canonical')
    or (p_kind='terminal_reader' and p_attempt<>'initial'
      and p_attempt !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then
    raise exception 'Intento inválido' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text || ':' || p_kind || ':' || p_attempt,23));
  select * into strict v_order from actv_payments.orders where id=p_order_id;
  if v_order.state<>'pending' or v_order.payment_provider<>'stripe'
    or (p_kind='checkout' and v_order.channel<>'online')
    or (p_kind<>'checkout' and v_order.channel<>'terminal') then
    raise exception 'Pedido incompatible' using errcode='23514'; end if;
  select authorized_at into v_at from actv_payments.provider_attempts
    where order_id=p_order_id and kind=p_kind and attempt=p_attempt;
  if found then
    if v_at>clock_timestamp() or v_at<=clock_timestamp()-interval '23 hours' then
      raise exception 'Ventana de recuperación cerrada' using errcode='23514'; end if;
    return true;
  end if;
  perform 1 from actv_payments.sales_control where singleton and not paused for share;
  if not found then raise exception 'Ventas pausadas: no se autorizan nuevos intentos' using errcode='P0001'; end if;
  if v_order.expires_at<=clock_timestamp() then
    raise exception 'Reserva vencida' using errcode='23514'; end if;
  insert into actv_payments.provider_attempts(order_id,kind,attempt) values(p_order_id,p_kind,p_attempt);
  return true;
end $$;

create function public.actv_staff_recent_orders(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Límite inválido' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(x.value order by x.created_at desc,x.id desc) from (
    select o.id,o.created_at,actv_payments.order_json(o.id)||jsonb_build_object(
      'request_id',o.request_id,'channel',o.channel,'event_id',o.event_id,
      'cart',jsonb_build_object('eventId',o.event_id,'relay',o.relay,'items',o.original_items),
      'shift_id',c.shift_id,'received',c.tendered,
      'reader_attempt',(select a.attempt from actv_payments.provider_attempts a
        where a.order_id=o.id and a.kind='terminal_reader' order by a.authorized_at desc limit 1)) as value
    from actv_payments.orders o left join actv_payments.captures c on c.order_id=o.id
    where o.channel in ('cash','terminal') and o.operator=auth.uid()
      and actv_payments.can_sell(auth.uid(),o.event_id)
    order by o.created_at desc,o.id desc limit p_limit
  ) x),'[]'::jsonb);
end $$;

create function public.actv_staff_recover_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'No autorizado' using errcode='42501'; end if;
  select actv_payments.order_json(o.id)||jsonb_build_object(
      'request_id',o.request_id,'channel',o.channel,'event_id',o.event_id,
      'cart',jsonb_build_object('eventId',o.event_id,'relay',o.relay,'items',o.original_items),
      'shift_id',c.shift_id,'received',c.tendered,
      'reader_attempt',(select a.attempt from actv_payments.provider_attempts a
        where a.order_id=o.id and a.kind='terminal_reader' order by a.authorized_at desc limit 1))
    into v_result from actv_payments.orders o left join actv_payments.captures c on c.order_id=o.id
    where o.id=p_order_id and o.channel in ('cash','terminal') and o.operator=auth.uid()
      and actv_payments.can_sell(auth.uid(),o.event_id);
  if v_result is null then raise exception 'Pedido no disponible' using errcode='42501'; end if;
  return v_result;
end $$;

revoke all on function actv_payments.guard_new_sale(),public.actv_sales_status(),
  public.actv_set_sales_pause(boolean,text),public.actv_authorize_provider_attempt(uuid,text,text),
  public.actv_staff_recent_orders(integer),public.actv_staff_recover_order(uuid) from public,anon,authenticated;
grant execute on function public.actv_sales_status(),public.actv_set_sales_pause(boolean,text),
  public.actv_staff_recent_orders(integer),public.actv_staff_recover_order(uuid) to authenticated;
grant execute on function public.actv_authorize_provider_attempt(uuid,text,text) to service_role;
commit;

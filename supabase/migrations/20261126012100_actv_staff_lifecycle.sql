begin;

alter table actv_payments.staff add column active boolean not null default true;
alter table actv_payments.staff drop constraint staff_role_check;
alter table actv_payments.staff add constraint staff_role_check check (role in ('manager','cashier','moderator'));
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('Administrador','Moderador','Cajero','PDV ACTV','Sin acceso'));

create table actv_payments.staff_audit (
  id bigint generated always as identity primary key,
  target_user uuid not null references auth.users,
  actor_user uuid not null references auth.users,
  occurred_at timestamptz not null default now(),
  before_state jsonb,
  after_state jsonb not null
);

create or replace function actv_payments.role(p_user uuid) returns text
language sql stable set search_path='' as $$
  select role from actv_payments.staff where user_id=p_user and active
$$;

create or replace function actv_payments.can_sell(p_user uuid,p_event uuid) returns boolean
language sql stable set search_path='' as $$
  select exists (
    select from actv_payments.staff s where s.user_id=p_user and s.active and
      (s.role='manager' or (s.role='cashier' and s.all_events) or exists (
        select from actv_payments.staff_events e where e.user_id=p_user and e.event_id=p_event
      ))
  )
$$;

-- Profile labels are mirrors, never a second staff-permission writer. The RPC
-- below and the Auth profile trigger execute as their trusted database owner.
-- A caller-controlled custom GUC is deliberately not an authorization boundary.
create function actv_payments.guard_profile_authority() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op in ('INSERT','DELETE') or new.rol is distinct from old.rol
      or new.eventos_asignados is distinct from old.eventos_asignados then
      raise exception 'Usa la administración de acceso del personal' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger actv_profile_authority before insert or update or delete on public.perfiles
for each row execute function actv_payments.guard_profile_authority();

create function public.actv_set_staff_access(
  p_user uuid,p_name text,p_phone text,p_role text,p_events uuid[] default '{}',p_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_auth auth.users;
  v_prior actv_payments.staff;
  v_events uuid[];
  v_role text;
  v_label text;
  v_before jsonb;
  v_after jsonb;
begin
  -- Serialize lifecycle changes, then recheck the actor. This also protects
  -- the last-manager invariant across concurrent demotion/revocation requests.
  perform pg_advisory_xact_lock(20261126,12100);
  if not actv_payments.is_manager(v_actor) then
    raise exception 'Acción reservada para administración' using errcode='42501';
  end if;
  if p_active is null or p_events is null or array_length(p_events,1)>1000
    or char_length(btrim(coalesce(p_name,''))) not between 1 and 150
    or char_length(coalesce(p_phone,''))>60 then
    raise exception 'Datos de personal inválidos' using errcode='22023';
  end if;
  v_role:=case p_role when 'Administrador' then 'manager' when 'PDV ACTV' then 'cashier'
    when 'Cajero' then 'cashier' when 'Moderador' then 'moderator' end;
  if v_role is null then raise exception 'Rol de personal inválido' using errcode='22023'; end if;
  select * into v_auth from auth.users where id=p_user;
  if not found then raise exception 'Cuenta de acceso no encontrada' using errcode='P0002'; end if;
  select * into v_prior from actv_payments.staff where user_id=p_user;
  if v_prior.user_id is null and coalesce(v_auth.raw_app_meta_data->>'actv_staff_identity','')<>'true' then
    raise exception 'La cuenta no fue preparada para personal' using errcode='42501';
  end if;
  if p_active and (v_auth.email is null or v_auth.email_confirmed_at is null) then
    raise exception 'Confirma el correo antes de activar el acceso' using errcode='22023';
  end if;
  select coalesce(array_agg(e order by e),'{}') into v_events
    from (select distinct unnest(p_events) e) selected;
  if exists(select from unnest(v_events) e where e is null or not exists(select from public.eventos r where r.id=e)) then
    raise exception 'Carrera asignada no encontrada' using errcode='22023';
  end if;
  if p_role in ('Administrador','PDV ACTV') and cardinality(v_events)>0 then
    raise exception 'Este rol no utiliza asignaciones individuales' using errcode='22023';
  end if;
  if v_prior.role='manager' and v_prior.active and (not p_active or v_role<>'manager')
    and not exists(select from actv_payments.staff where user_id<>p_user and role='manager' and active) then
    raise exception 'Debe conservarse al menos un administrador activo' using errcode='23514';
  end if;
  v_before:=jsonb_build_object('profile',(select to_jsonb(p) from public.perfiles p where id=p_user),
    'staff',to_jsonb(v_prior),'events',(select coalesce(jsonb_agg(event_id order by event_id),'[]')
      from actv_payments.staff_events where user_id=p_user));
  if not p_active then v_events:='{}'; end if;
  v_label:=case when p_active then p_role else 'Sin acceso' end;
  insert into public.perfiles(id,email,nombre_completo,telefono,rol,eventos_asignados)
    values(p_user,v_auth.email,btrim(p_name),btrim(coalesce(p_phone,'')),v_label,v_events)
    on conflict(id) do update set email=excluded.email,nombre_completo=excluded.nombre_completo,
      telefono=excluded.telefono,rol=excluded.rol,eventos_asignados=excluded.eventos_asignados;
  insert into actv_payments.staff(user_id,role,all_events,active)
    values(p_user,v_role,p_active and p_role='PDV ACTV',p_active)
    on conflict(user_id) do update set role=excluded.role,all_events=excluded.all_events,active=excluded.active;
  delete from actv_payments.staff_events where user_id=p_user;
  insert into actv_payments.staff_events(user_id,event_id) select p_user,unnest(v_events);
  v_after:=jsonb_build_object('profile',(select to_jsonb(p) from public.perfiles p where id=p_user),
    'staff',(select to_jsonb(s) from actv_payments.staff s where user_id=p_user),'events',to_jsonb(v_events));
  if v_before is distinct from v_after then
    insert into actv_payments.staff_audit(target_user,actor_user,before_state,after_state)
      values(p_user,v_actor,v_before,v_after);
  end if;
  return jsonb_build_object('user_id',p_user,'active',p_active,'role',v_role,'events',v_events);
end $$;

create function public.actv_list_staff() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not actv_payments.is_manager(auth.uid()) then
    raise exception 'Acción reservada para administración' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,'nombre_completo',coalesce(p.nombre_completo,u.raw_user_meta_data->>'nombre_completo',u.email),
    'telefono',coalesce(p.telefono,u.raw_user_meta_data->>'telefono',''),
    'rol',case when s.user_id is null then 'Cajero' when not s.active then 'Sin acceso'
      when s.role='manager' then 'Administrador' when s.role='moderator' then 'Moderador'
      when s.all_events then 'PDV ACTV' else 'Cajero' end,
    'eventos_asignados',coalesce((select jsonb_agg(event_id order by event_id)
      from actv_payments.staff_events where user_id=u.id),'[]'),
    'staff_active',coalesce(s.active,false),'staff_pending',s.user_id is null
  ) order by p.nombre_completo,u.id),'[]') from auth.users u left join public.perfiles p on p.id=u.id
    left join actv_payments.staff s on s.user_id=u.id
    where s.user_id is not null or coalesce(u.raw_app_meta_data->>'actv_staff_identity','')='true');
end $$;

-- Explicit manager lookup supports adopting a retained Auth identity without
-- replacing its password or inferring authority from a legacy profile label.
create function public.actv_find_staff_identity(p_email text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_id uuid;
begin
  if not actv_payments.is_manager(auth.uid()) then
    raise exception 'Acción reservada para administración' using errcode='42501';
  end if;
  select id into strict v_id from auth.users where lower(email)=lower(btrim(p_email));
  return v_id;
exception when no_data_found then
  raise exception 'No se encontró una cuenta con ese correo' using errcode='P0002';
end $$;

create function public.actv_staff_password_target(p_user uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if not actv_payments.is_manager(auth.uid()) or not exists(
    select from actv_payments.staff where user_id=p_user and active) then
    raise exception 'Cuenta de personal no autorizada' using errcode='42501';
  end if;
  return true;
end $$;

revoke all on function public.actv_set_staff_access(uuid,text,text,text,uuid[],boolean),
  public.actv_list_staff(),public.actv_find_staff_identity(text),public.actv_staff_password_target(uuid) from public,anon,authenticated;
grant execute on function public.actv_set_staff_access(uuid,text,text,text,uuid[],boolean),
  public.actv_list_staff(),public.actv_find_staff_identity(text),public.actv_staff_password_target(uuid) to authenticated;

-- A still-valid Auth token must not retain old staff financial capabilities.
-- Guest online status-token authorization remains independent and unchanged.
create or replace function public.actv_cash_shift() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  return (select actv_payments.shift_json(id) from actv_payments.shifts
    where operator=auth.uid() and closed_at is null);
end $$;

create or replace function public.actv_close_shift(p_shift_id uuid,p_counted bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_shift actv_payments.shifts;
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'No autorizado' using errcode='42501'; end if;
  select * into strict v_shift from actv_payments.shifts where id=p_shift_id for update;
  if auth.uid() is null or v_shift.operator<>auth.uid() then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_counted is null or p_counted not between 0 and 100000000 then raise exception 'Conteo inválido'; end if;
  if v_shift.closed_at is not null and v_shift.counted<>p_counted then raise exception 'El corte ya quedó registrado'; end if;
  if v_shift.closed_at is null then
    update actv_payments.shifts set closed_at=now(),counted=p_counted,
      expected=opening+(select coalesce(sum(amount),0) from actv_payments.captures where shift_id=p_shift_id)
    where id=p_shift_id;
  end if;
  return actv_payments.shift_json(p_shift_id);
end $$;

create or replace function public.actv_cancel_cash(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'No autorizado' using errcode='42501'; end if;
  update actv_payments.orders set state='closed'
    where id=p_order_id and channel='cash' and operator=auth.uid() and actv_payments.can_sell(auth.uid(),event_id) and state='pending'
      and not exists(select 1 from actv_payments.captures where order_id=p_order_id);
  return public.actv_staff_order_status(p_order_id);
end $$;

create or replace function public.actv_order_status(p_order_id uuid,p_status_token uuid default null,p_operator uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1 from actv_payments.orders o where o.id=p_order_id and (
      (p_status_token is not null and o.status_token=p_status_token and o.channel='online')
      or (p_operator is not null and actv_payments.role(p_operator) is not null
        and actv_payments.can_sell(p_operator,o.event_id)
        and (o.operator=p_operator or actv_payments.is_manager(p_operator)))
    )
  ) then raise exception 'Pedido no disponible' using errcode='42501'; end if;
  return actv_payments.order_json(p_order_id);
end $$;

create or replace function public.actv_staff_order_status(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  return public.actv_order_status(p_order_id,null,auth.uid());
end $$;

commit;

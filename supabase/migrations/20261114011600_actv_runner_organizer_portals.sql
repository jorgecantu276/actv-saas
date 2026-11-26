begin;

create table actv_payments.attendance (
  registration_id uuid primary key references public.inscripciones on delete cascade,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users on delete set null
);

create table actv_payments.runner_entries (
  registration_id uuid primary key references public.inscripciones on delete cascade,
  event_id uuid not null references actv_payments.events,
  user_id uuid not null references auth.users on delete cascade,
  achievement_slug text unique check (achievement_slug ~ '^[a-f0-9]{32}$'),
  unique(event_id, user_id)
);

-- Public sign-up cannot extend the legacy POS permissions granted to signed-in staff.
do $$
declare table_name text;
begin
  foreach table_name in array array['clientes','clubes','cotizaciones','servicios'] loop
    if to_regclass(format('public.%I',table_name)) is not null then
      execute format('alter table public.%I enable row level security',table_name);
      execute format(
        'create policy actv_legacy_staff_only on public.%I as restrictive for all to authenticated
         using ((select public.actv_is_payment_staff())) with check ((select public.actv_is_payment_staff()))',
        table_name
      );
    end if;
  end loop;
end $$;

-- When available, the legacy profile trigger must treat user metadata as untrusted.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute $definition$
      create or replace function public.handle_new_user() returns trigger
      language plpgsql security definer set search_path='' as $function$
      begin
        insert into public.perfiles (id,email,nombre_completo,rol)
        values (new.id,new.email,new.raw_user_meta_data->>'nombre_completo','Cajero')
        on conflict (id) do nothing;
        return new;
      end $function$
    $definition$;
  end if;
end $$;

-- Keep old UUID-based checkout links unambiguous.
create function actv_payments.guard_event_slug() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.slug ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and (tg_op='INSERT' or new.slug is distinct from old.slug) then
    raise exception 'La dirección de la carrera no puede ser un identificador de evento' using errcode='22023';
  end if;
  return new;
end $$;

create trigger actv_guard_event_slug before insert or update of slug on actv_payments.events
for each row execute function actv_payments.guard_event_slug();

create index actv_orders_runner_email on actv_payments.orders (lower(buyer_email))
  where channel='online' and state='issued' and buyer_email is not null;

create function actv_payments.verified_email(p_user uuid)
returns text language sql stable set search_path='' as $$
  select lower(u.email) from auth.users u where u.id=p_user and u.email_confirmed_at is not null
$$;

create function public.actv_organizer_signup(p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(p_name);
  v_organizer actv_payments.organizers;
begin
  if actv_payments.verified_email(v_user) is null then
    raise exception 'Confirma tu correo para continuar' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name) not between 3 and 100 then
    raise exception 'Escribe un nombre de organizador válido' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 11600));
  select o.* into v_organizer from actv_payments.members m
    join actv_payments.organizers o on o.id=m.organizer_id
    where m.user_id=v_user order by o.id limit 1;
  if not found then
    insert into public.perfiles (id,email,rol)
      values (v_user,actv_payments.verified_email(v_user),'Cajero') on conflict (id) do nothing;
    insert into actv_payments.organizers (name) values (v_name) returning * into v_organizer;
    insert into actv_payments.members (organizer_id,user_id) values (v_organizer.id,v_user);
  end if;
  return jsonb_build_object('organizer_id',v_organizer.id,'name',v_organizer.name);
end $$;

create or replace function public.actv_set_account(
  p_operator uuid,p_event_id uuid,p_account_id text,p_live_mode boolean,p_ready boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_organizer uuid;
  v_mode boolean;
begin
  perform public.actv_organizer(p_operator,p_event_id);
  select organizer_id,live_mode into strict v_organizer,v_mode
    from actv_payments.events where event_id=p_event_id for update;
  if v_mode is distinct from p_live_mode then
    raise exception 'El evento pertenece a otro entorno de pago' using errcode='23514';
  end if;
  insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready)
    values(v_organizer,p_live_mode,p_account_id,p_ready)
  on conflict(organizer_id,live_mode) do update set ready=excluded.ready
    where accounts.account_id=excluded.account_id;
  if not found then raise exception 'La cuenta del organizador ya está asignada'; end if;
  return public.actv_organizer(p_operator,p_event_id);
end $$;

create function public.actv_organizer_events()
returns jsonb language sql stable security definer set search_path='' as $$
  with owned as (
    select o.id,o.name from actv_payments.members m join actv_payments.organizers o on o.id=m.organizer_id
    where m.user_id=auth.uid() order by o.id
  )
  select jsonb_build_object(
    'organizer_id',(select id from owned limit 1),
    'organizer_name',(select name from owned limit 1),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object('event_id',e.id,'name',e.nombre_carrera,'slug',c.slug,'date',e.fecha)
        order by e.fecha desc,e.id)
      from actv_payments.events c join public.eventos e on e.id=c.event_id
      join owned o on o.id=c.organizer_id
    ),'[]'::jsonb)
  )
$$;

create function public.actv_create_organizer_event(p_name text,p_date date,p_slug text,p_price integer,p_capacity integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(p_name);
  v_slug text := btrim(p_slug);
  v_organizer actv_payments.organizers;
  v_today date := (now() at time zone 'America/Matamoros')::date;
  v_event uuid;
begin
  if actv_payments.verified_email(v_user) is null then
    raise exception 'Confirma tu correo para continuar' using errcode='42501';
  end if;
  select o.* into v_organizer from actv_payments.members m
    join actv_payments.organizers o on o.id=m.organizer_id
    where m.user_id=v_user order by o.id limit 1;
  if not found then
    raise exception 'Crea tu cuenta de organizador' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name) not between 3 and 100
    or p_date is null or p_date not between v_today and v_today+3650
    or v_slug is null or char_length(v_slug) not between 2 and 80 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_price is null or p_price not between 1600 and 10000000
    or p_capacity is null or p_capacity not between 1 and 20000 then
    raise exception 'Revisa los datos de la carrera' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_slug,11601));
  select e.id into v_event
  from public.eventos e join actv_payments.events c on c.event_id=e.id
  where c.slug=v_slug and c.organizer_id=v_organizer.id and not c.live_mode
    and (e.nombre_carrera,e.fecha,e.precio_1,e.cupo_maximo) =
      (v_name,p_date,p_price::numeric/100,p_capacity);
  if not found then
    insert into public.eventos(nombre_carrera,fecha,organizador,distancia,nombre_precio_1,precio_1,cupo_maximo,folio_inicial)
    values(v_name,p_date,v_organizer.name,'Por confirmar','Individual',p_price::numeric/100,p_capacity,1)
    returning id into v_event;
    insert into actv_payments.events(event_id,organizer_id,slug,live_mode,online_enabled,sandbox_fee_per_folio)
    values(v_event,v_organizer.id,v_slug,false,false,1500);
  end if;
  return jsonb_build_object('event_id',v_event,'name',v_name,'slug',v_slug,'date',p_date);
end $$;

create function actv_payments.can_record_attendance(p_user uuid,p_event uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select from actv_payments.events e where e.event_id=p_event
      and (actv_payments.can_manage(p_user,e.organizer_id) or actv_payments.can_sell(p_user,e.event_id))
  )
$$;

create function public.actv_organizer_attendance(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not actv_payments.can_record_attendance(auth.uid(),p_event_id) then
    raise exception 'Organizador no asignado al evento' using errcode='42501';
  end if;
  return (
    select jsonb_build_object('sales',count(*),'attended',count(a.registration_id),
      'can_record',(select e.fecha <= (now() at time zone 'America/Matamoros')::date from public.eventos e where e.id=p_event_id),
      'registrations',coalesce(jsonb_agg(jsonb_build_object(
        'registration_id',r.id,'folio',r.folio_asignado,
        'name',concat_ws(' ',at.nombre,at.apellido),
        'attended',a.registration_id is not null
      ) order by r.folio_asignado),'[]'::jsonb))
    from public.inscripciones r join public.atletas at on at.id=r.atleta_id
    left join actv_payments.attendance a on a.registration_id=r.id
    where r.evento_id=p_event_id and r.actv_eligible and r.folio_asignado is not null
  );
end $$;

create function public.actv_record_attendance(p_event_id uuid,p_registration_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not actv_payments.can_record_attendance(auth.uid(),p_event_id) then
    raise exception 'Organizador no asignado al evento' using errcode='42501';
  end if;
  perform from public.inscripciones r join public.eventos e on e.id=r.evento_id
    where r.id=p_registration_id and r.evento_id=p_event_id and r.actv_eligible
      and r.folio_asignado is not null and e.fecha <= (now() at time zone 'America/Matamoros')::date
    for update of r;
  if not found then
    raise exception 'El folio no está disponible para registrar asistencia hoy' using errcode='P0002';
  end if;
  insert into actv_payments.attendance(registration_id,recorded_by)
  values(p_registration_id,auth.uid()) on conflict(registration_id) do nothing;
  return true;
end $$;

create function actv_payments.runner_registrations(p_user uuid)
returns table(registration_id uuid,event_id uuid,event_name text,event_date date,folio text,
  attended boolean,personal boolean,achievement_slug text)
language sql stable set search_path='' as $$
  select r.id,e.id,e.nombre_carrera,e.fecha,r.folio_asignado,
    a.registration_id is not null, s.registration_id is not null,
    s.achievement_slug
  from actv_payments.orders o
  join actv_payments.items i on i.order_id=o.id
  join public.inscripciones r on r.actv_order_item_id=i.id
  join public.eventos e on e.id=o.event_id
  left join actv_payments.attendance a on a.registration_id=r.id
  left join actv_payments.runner_entries s on s.registration_id=r.id and s.user_id=p_user
  where o.channel='online' and o.state='issued' and o.buyer_email is not null and r.actv_eligible
    and r.folio_asignado is not null and (s.registration_id is not null or lower(o.buyer_email)=actv_payments.verified_email(p_user))
$$;

create function public.actv_runner_dashboard()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'registrations',coalesce(jsonb_agg(to_jsonb(r)-'registration_id' order by r.event_date desc,r.event_id,r.folio),'[]'::jsonb),
    'attended_count',count(distinct r.event_id) filter (where r.attended and r.personal)
  )
  from actv_payments.runner_registrations(auth.uid()) r
$$;

create function public.actv_claim_runner_folio(p_event_id uuid,p_folio text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_registration uuid;
begin
  if actv_payments.verified_email(auth.uid()) is null then
    raise exception 'Confirma tu correo para continuar' using errcode='42501';
  end if;
  select r.registration_id into v_registration from actv_payments.runner_registrations(auth.uid()) r
    where r.event_id=p_event_id and r.folio=p_folio;
  if not found then raise exception 'Folio no disponible' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_event_id::text,11602));
  delete from actv_payments.runner_entries x
    using public.inscripciones r,actv_payments.items i,actv_payments.orders o
    where x.user_id=auth.uid() and x.event_id=p_event_id and x.registration_id=r.id
      and r.actv_order_item_id=i.id and i.order_id=o.id and o.state='voided';
  insert into actv_payments.runner_entries(registration_id,event_id,user_id)
    values(v_registration,p_event_id,auth.uid()) on conflict do nothing;
  return exists (select from actv_payments.runner_entries s where s.registration_id=v_registration and s.user_id=auth.uid());
end $$;

create function public.actv_publish_achievement(p_event_id uuid,p_folio text)
returns text language plpgsql security definer set search_path='' as $$
declare v_slug text;
begin
  update actv_payments.runner_entries s
    set achievement_slug=coalesce(s.achievement_slug,replace(gen_random_uuid()::text,'-',''))
    from actv_payments.runner_registrations(auth.uid()) r
    where s.registration_id=r.registration_id and s.user_id=auth.uid()
      and r.event_id=p_event_id and r.folio=p_folio and r.personal and r.attended
    returning s.achievement_slug into v_slug;
  if not found then raise exception 'Logro no disponible' using errcode='P0002'; end if;
  return v_slug;
end $$;

create function public.actv_unpublish_achievement(p_event_id uuid,p_folio text)
returns boolean language sql security definer set search_path='' as $$
  with updated as (
    update actv_payments.runner_entries s set achievement_slug=null
    from public.inscripciones r
    where r.id=s.registration_id and s.user_id=auth.uid()
      and s.event_id=p_event_id and r.folio_asignado=p_folio
    returning s.registration_id
  )
  select exists (select from updated)
$$;

create function public.actv_public_achievement(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('event_name',e.nombre_carrera,'event_date',e.fecha)
  from actv_payments.runner_entries s join actv_payments.attendance a using(registration_id)
  join public.inscripciones r on r.id=s.registration_id
  join public.eventos e on e.id=s.event_id
  join actv_payments.items i on i.id=r.actv_order_item_id
  join actv_payments.orders o on o.id=i.order_id
  where s.achievement_slug=p_slug and r.actv_eligible and o.state='issued'
$$;

create function public.actv_public_races(p_live_mode boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(course order by event_date,event_id),'[]'::jsonb)
  from (
    select e.fecha as event_date,e.id as event_id,
      jsonb_build_object('event_id',e.id,'name',e.nombre_carrera,'date',e.fecha,
        'distance',e.distancia,'slug',coalesce(c.slug,e.id::text),
        'price',p.minimum_price,'available',greatest(0,e.cupo_maximo-actv_payments.used(e.id))) as course
    from actv_payments.events c join public.eventos e on e.id=c.event_id
    join actv_payments.accounts a on a.organizer_id=c.organizer_id and a.live_mode=c.live_mode and a.ready
    cross join lateral (
      select min((price*100)::bigint) as minimum_price
      from (values (e.nombre_precio_1,e.precio_1),(e.nombre_precio_2,e.precio_2)) x(label,price)
      where label is not null and price between 10 and 999999.99 and price*100=trunc(price*100)
        and (not c.live_commission_enabled or price>15)
    ) p
    where c.live_mode=p_live_mode and c.online_enabled and e.activo and p.minimum_price is not null
      and e.fecha >= (now() at time zone 'America/Matamoros')::date
    order by e.fecha,e.id limit 100
  ) visible
$$;

revoke all on function
  public.actv_organizer_signup(text), public.actv_organizer_events(),
  public.actv_create_organizer_event(text,date,text,integer,integer), public.actv_organizer_attendance(uuid),
  public.actv_record_attendance(uuid,uuid), public.actv_runner_dashboard(), public.actv_claim_runner_folio(uuid,text),
  public.actv_publish_achievement(uuid,text), public.actv_unpublish_achievement(uuid,text),
  public.actv_public_achievement(text), public.actv_public_races(boolean)
from public,anon,authenticated;

grant execute on function
  public.actv_organizer_signup(text), public.actv_organizer_events(),
  public.actv_create_organizer_event(text,date,text,integer,integer), public.actv_organizer_attendance(uuid),
  public.actv_record_attendance(uuid,uuid), public.actv_runner_dashboard(), public.actv_claim_runner_folio(uuid,text),
  public.actv_publish_achievement(uuid,text), public.actv_unpublish_achievement(uuid,text)
to authenticated;

grant execute on function public.actv_public_achievement(text), public.actv_public_races(boolean)
to anon,authenticated;

commit;


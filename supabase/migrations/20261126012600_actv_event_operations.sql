begin;

-- One event scope for staff and organizer operations. Membership never grants
-- staff sales, evidence, correction or financial-manager authority.
create function actv_payments.can_operate_event(p_user uuid,p_event uuid) returns boolean
language sql stable set search_path='' as $$
  select p_user is not null and (actv_payments.can_sell(p_user,p_event) or exists(
    select 1 from actv_payments.events c join actv_payments.members m on m.organizer_id=c.organizer_id
    where c.event_id=p_event and m.user_id=p_user))
$$;

create function public.actv_operations_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501'; end if;
  return jsonb_build_object('user_id',auth.uid(),'staff',actv_payments.role(auth.uid()) is not null,
    'manager',actv_payments.is_manager(auth.uid()),'organizer',exists(select 1 from actv_payments.members where user_id=auth.uid()),
    'can_create_event',actv_payments.is_manager(auth.uid()) or exists(select 1 from actv_payments.members where user_id=auth.uid()),
    'staff_label',(select rol from public.perfiles where id=auth.uid()));
end $$;

create function public.actv_operations_event(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_value jsonb;
begin
  if not actv_payments.can_operate_event(auth.uid(),p_event_id) then raise exception 'Evento no asignado' using errcode='42501'; end if;
  select to_jsonb(e)||jsonb_build_object('can_sell',actv_payments.can_sell(auth.uid(),e.id),
    'can_manage',actv_payments.is_manager(auth.uid()) or exists(select 1 from actv_payments.members where organizer_id=c.organizer_id and user_id=auth.uid()),
    'live_mode',coalesce(c.live_mode,false),'online_enabled',coalesce(c.online_enabled,false),'slug',c.slug,
    'reader_id',c.reader_id,'ready',coalesce(a.ready,false))
  into v_value from public.eventos e left join actv_payments.events c on c.event_id=e.id
    left join actv_payments.accounts a on a.organizer_id=c.organizer_id and a.live_mode=c.live_mode where e.id=p_event_id;
  return v_value;
end $$;

create function public.actv_operations_events(p_query text default '',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 100
    or p_query is null or length(p_query)>120 then raise exception 'Página inválida' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from public.eventos e where actv_payments.can_operate_event(auth.uid(),e.id)
      and position(lower(p_query) in lower(e.nombre_carrera))>0),
    'rows',coalesce((select jsonb_agg(x.value order by x.fecha desc,x.id) from (
      select e.id,e.fecha,to_jsonb(e)||jsonb_build_object('can_sell',actv_payments.can_sell(auth.uid(),e.id),
        'can_manage',actv_payments.is_manager(auth.uid()) or exists(select 1 from actv_payments.events c
          join actv_payments.members m on m.organizer_id=c.organizer_id where c.event_id=e.id and m.user_id=auth.uid()),
        'live_mode',coalesce(c.live_mode,false),'online_enabled',coalesce(c.online_enabled,false),'slug',c.slug,
        'ready',coalesce(a.ready,false)) as value
      from public.eventos e left join actv_payments.events c on c.event_id=e.id
      left join actv_payments.accounts a on a.organizer_id=c.organizer_id and a.live_mode=c.live_mode
      where actv_payments.can_operate_event(auth.uid(),e.id) and position(lower(p_query) in lower(e.nombre_carrera))>0
      order by e.fecha desc,e.id offset p_offset limit p_limit) x),'[]'::jsonb));
end $$;

create function public.actv_operations_roster(p_event_id uuid,p_query text default '',p_offset integer default 0,
  p_limit integer default 50,p_filter text default 'all',p_sort text default 'folio_asc') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_sell boolean; v_rows jsonb; v_total bigint; v_stats jsonb;
begin
  if not actv_payments.can_operate_event(auth.uid(),p_event_id) then raise exception 'Evento no asignado' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 100
    or p_query is null or length(p_query)>120 or p_filter is null or p_filter not in ('all','pending','delivered','present','unrecorded')
    or p_sort is null or p_sort not in ('folio_asc','folio_desc','fecha_asc','fecha_desc','nombre_asc','nombre_desc')
    then raise exception 'Página inválida' using errcode='22023'; end if;
  v_sell:=actv_payments.can_sell(auth.uid(),p_event_id);
  with records as (
    select r.*,s.effective->'participant' as participant,s.effective->'event' as snapshot_event,a.registration_id is not null as attended,
      s.revision,s.provenance from public.inscripciones r
    join actv_payments.registration_snapshots s on s.registration_id=r.id
    left join actv_payments.attendance a on a.registration_id=r.id where r.evento_id=p_event_id
  ), filtered as (
    select * from records where position(lower(p_query) in lower(concat_ws(' ',folio_asignado,participant->>'nombre',participant->>'apellido')))>0
      and (p_filter='all' or (p_filter='pending' and not coalesce(kit_entregado,false))
        or (p_filter='delivered' and coalesce(kit_entregado,false)) or (p_filter='present' and attended)
        or (p_filter='unrecorded' and not attended))
  ), numbered as (select *,row_number() over(order by
      case when p_sort='folio_asc' then folio_asignado end asc,
      case when p_sort='folio_desc' then folio_asignado end desc,
      case when p_sort='fecha_asc' then created_at end asc,
      case when p_sort='fecha_desc' then created_at end desc,
      case when p_sort='nombre_asc' then concat_ws(' ',participant->>'nombre',participant->>'apellido') end asc,
      case when p_sort='nombre_desc' then concat_ws(' ',participant->>'nombre',participant->>'apellido') end desc,id) as ord from filtered
  ), paged as (select * from numbered order by ord offset p_offset limit p_limit)
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'registration_id',id,'atleta_id',atleta_id,'evento_id',evento_id,'folio_asignado',folio_asignado,
      'created_at',created_at,'kit_entregado',kit_entregado,'foto_evidencia',case when v_sell then foto_evidencia end,
      'paquete_comprado',paquete_comprado,'monto_pagado',case when v_sell then monto_pagado end,
      'actv_eligible',actv_eligible,'attended',attended,'atletas',participant,'revision',revision,'provenance',provenance,
      'eventos',jsonb_build_object('nombre_carrera',snapshot_event->>'name','fecha',snapshot_event->>'date'),
      'perfiles',case when v_sell then (select jsonb_build_object('nombre_completo',nombre_completo) from public.perfiles where id=usuario_id) end)
      order by ord) from paged),'[]'::jsonb),
    (select jsonb_build_object('registrations',count(*),'eligible',count(*) filter(where actv_eligible is true),
      'legacy_unknown',count(*) filter(where actv_eligible is null),'ineligible',count(*) filter(where actv_eligible is false),
      'kits',count(*) filter(where kit_entregado),'attended',count(*) filter(where attended)) from records)
    into v_total,v_rows,v_stats;
  return jsonb_build_object('rows',v_rows,'total',v_total,'stats',v_stats,'can_sell',v_sell,
    'can_record',(select fecha <= (now() at time zone 'America/Matamoros')::date from public.eventos where id=p_event_id));
end $$;

create function public.actv_operations_athletes(p_query text default '',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'Personal requerido' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 100
    or p_query is null or length(p_query)>120 then raise exception 'Página inválida' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from public.atletas a where
      position(lower(p_query) in lower(concat_ws(' ',a.nombre,a.apellido,a.telefono,to_jsonb(a)->>'club')))>0),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.apellido,x.nombre,x.id) from (
      select * from public.atletas a where position(lower(p_query) in lower(concat_ws(' ',a.nombre,a.apellido,a.telefono,to_jsonb(a)->>'club')))>0
      order by a.apellido,a.nombre,a.id offset p_offset limit p_limit) x),'[]'::jsonb));
end $$;

create function public.actv_operations_history(p_athlete_id uuid,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'Personal requerido' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Página inválida' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from public.inscripciones r where r.atleta_id=p_athlete_id
      and actv_payments.can_sell(auth.uid(),r.evento_id)),
    'rows',coalesce((select jsonb_agg(x.value order by x.fecha desc,x.id) from (
      select r.id,e.fecha,to_jsonb(r)||jsonb_build_object('atletas',s.effective->'participant',
        'eventos',jsonb_build_object('nombre_carrera',s.effective->'event'->>'name','fecha',s.effective->'event'->>'date'),
        'perfiles',(select jsonb_build_object('nombre_completo',nombre_completo) from public.perfiles where id=r.usuario_id)) as value
      from public.inscripciones r join actv_payments.registration_snapshots s on s.registration_id=r.id
        join public.eventos e on e.id=r.evento_id where r.atleta_id=p_athlete_id and actv_payments.can_sell(auth.uid(),r.evento_id)
      order by e.fecha desc,r.id offset p_offset limit p_limit) x),'[]'::jsonb));
end $$;

create table actv_payments.event_operation_audit(
  id bigint generated always as identity primary key,event_id uuid not null references public.eventos,
  actor uuid not null references auth.users,recorded_at timestamptz not null default now(),
  before_state jsonb,after_state jsonb not null
);
revoke all on actv_payments.event_operation_audit from public,anon,authenticated;

create function public.actv_operations_athlete_duplicate(p_name text,p_surname text,p_phone_last4 text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'Personal requerido' using errcode='42501'; end if;
  if p_name is null or length(p_name) not between 1 and 100 or p_surname is null or length(p_surname) not between 1 and 100
    or p_phone_last4 is null or p_phone_last4 !~ '^[0-9]{4}$' then raise exception 'Datos inválidos' using errcode='22023'; end if;
  return exists(select 1 from public.atletas where
    translate(lower(btrim(nombre)),'áéíóúüñ','aeiouun')=translate(lower(btrim(p_name)),'áéíóúüñ','aeiouun')
    and translate(lower(btrim(apellido)),'áéíóúüñ','aeiouun')=translate(lower(btrim(p_surname)),'áéíóúüñ','aeiouun')
    and right(regexp_replace(telefono,'[^0-9]','','g'),4)=p_phone_last4);
end $$;

create function public.actv_operations_save_event(p_event_id uuid,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.eventos; c actv_payments.events; v_org uuid; v_org_name text; v_mode boolean; v_sold boolean;
  v_name text; v_date date; v_capacity integer; v_price numeric; v_price2 numeric; v_slug text; v_online boolean; v_before jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501'; end if;
  if p_event_id is null or jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'Datos inválidos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('name','date','capacity','price','package_name',
    'price2','package_name2','distance','description','image','slug','live_mode','online_enabled','folio_start','reader_id')) then
    raise exception 'Campo no permitido' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,12600));
  select * into e from public.eventos where id=p_event_id for update;
  if e.id is not null then
    select * into c from actv_payments.events where event_id=e.id for update;
    if not actv_payments.is_manager(auth.uid()) and not exists(select 1 from actv_payments.members
      where organizer_id=c.organizer_id and user_id=auth.uid()) then raise exception 'No autorizado' using errcode='42501'; end if;
    v_org:=coalesce(c.organizer_id,'00000000-0000-4000-8000-000000000ac7');
    v_before:=jsonb_build_object('event',to_jsonb(e),'configuration',to_jsonb(c));
  else
    if actv_payments.verified_email(auth.uid()) is null then
      raise exception 'Confirma tu correo antes de crear una carrera' using errcode='42501'; end if;
    if actv_payments.is_manager(auth.uid()) then v_org:='00000000-0000-4000-8000-000000000ac7';
    else select organizer_id into v_org from actv_payments.members where user_id=auth.uid() order by organizer_id limit 1; end if;
    if v_org is null then raise exception 'No autorizado' using errcode='42501'; end if;
  end if;
  if p_values ? 'reader_id' and not actv_payments.is_manager(auth.uid()) then
    raise exception 'Solo administración puede configurar terminales' using errcode='42501'; end if;
  if p_values ? 'reader_id' and nullif(p_values->>'reader_id','') is not null and p_values->>'reader_id' !~ '^tmr_[A-Za-z0-9]+$' then
    raise exception 'Terminal inválida' using errcode='22023'; end if;
  select name into v_org_name from actv_payments.organizers where id=v_org;
  v_name:=btrim(p_values->>'name');v_date:=(p_values->>'date')::date;v_capacity:=(p_values->>'capacity')::integer;
  v_price:=(p_values->>'price')::numeric;v_price2:=nullif(p_values->>'price2','')::numeric;
  v_slug:=nullif(btrim(p_values->>'slug'),'');v_online:=(p_values->>'online_enabled')::boolean;
  if jsonb_typeof(p_values->'live_mode') is distinct from 'boolean' or jsonb_typeof(p_values->'online_enabled') is distinct from 'boolean'
    then raise exception 'Selecciona el entorno y la publicación' using errcode='22023'; end if;
  v_mode:=(p_values->>'live_mode')::boolean;
  if v_name is null or length(v_name) not between 3 and 100 or v_date is null
    or v_capacity is null or v_capacity not between 1 and 20000 or v_price is null or v_price not between 0.01 and 999999.99
    or v_price*100<>trunc(v_price*100) or length(coalesce(p_values->>'package_name','')) not between 1 and 100
    or length(coalesce(p_values->>'distance','')) not between 1 and 45
    or length(coalesce(p_values->>'description',''))>10000 or length(coalesce(p_values->>'image',''))>2000
    or (v_price2 is not null and (v_price2 not between 0.01 and 999999.99 or v_price2*100<>trunc(v_price2*100)
      or length(coalesce(p_values->>'package_name2','')) not between 1 and 100))
    or (v_slug is not null and (v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) not between 2 and 80
      or v_slug ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) then raise exception 'Revisa los datos de la carrera' using errcode='22023'; end if;
  if e.id is null and (v_date < (now() at time zone 'America/Matamoros')::date or v_date>(now() at time zone 'America/Matamoros')::date+3650)
    then raise exception 'Fecha no disponible' using errcode='22023'; end if;
  v_sold:=exists(select 1 from public.inscripciones where evento_id=p_event_id)
    or exists(select 1 from actv_payments.orders where event_id=p_event_id);
  if e.id is not null and v_sold and (v_name,v_date,v_mode,v_slug) is distinct from (e.nombre_carrera,e.fecha,coalesce(c.live_mode,false),c.slug) then
    raise exception 'La edición ya tiene obligaciones; conserva nombre, fecha, dirección y entorno' using errcode='23514'; end if;
  if v_capacity<actv_payments.used(p_event_id) then raise exception 'El cupo no cubre las obligaciones existentes' using errcode='23514'; end if;
  if v_online and (v_price<10 or (v_price2 is not null and v_price2<10)
    or not exists(select 1 from actv_payments.accounts where organizer_id=v_org and live_mode=v_mode and ready))
    then raise exception 'Conecta y verifica la cuenta del entorno antes de publicar' using errcode='23514'; end if;
  if e.id is null then
    if coalesce((p_values->>'folio_start')::integer,1) not between 1 and 99999999 then raise exception 'Folio inicial inválido' using errcode='22023'; end if;
    insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,nombre_precio_1,precio_1,nombre_precio_2,precio_2,
      cupo_maximo,folio_inicial,descripcion) values(p_event_id,v_name,v_date,v_org_name,p_values->>'distance',p_values->>'package_name',
      v_price,nullif(p_values->>'package_name2',''),v_price2,v_capacity,coalesce((p_values->>'folio_start')::integer,1),p_values->>'description');
  else
    update public.eventos set nombre_carrera=v_name,fecha=v_date,distancia=p_values->>'distance',nombre_precio_1=p_values->>'package_name',
      precio_1=v_price,nombre_precio_2=nullif(p_values->>'package_name2',''),precio_2=v_price2,cupo_maximo=v_capacity,descripcion=p_values->>'description'
      where id=p_event_id;
  end if;
  -- Optional legacy image column is present in the complete captured baseline;
  -- the bounded payment fixture deliberately omits it.
  if exists(select 1 from pg_attribute where attrelid='public.eventos'::regclass and attname='imagen_evento' and not attisdropped) then
    execute 'update public.eventos set imagen_evento=$1 where id=$2' using nullif(p_values->>'image',''),p_event_id;
  end if;
  insert into actv_payments.events(event_id,organizer_id,live_mode,online_enabled,slug,reader_id)
    values(p_event_id,v_org,v_mode,v_online,v_slug,nullif(p_values->>'reader_id',''))
    on conflict(event_id) do update set
      reader_id=case when events.live_mode is distinct from excluded.live_mode then null
        when p_values ? 'reader_id' then excluded.reader_id else events.reader_id end,
      live_commission_enabled=case when events.live_mode is distinct from excluded.live_mode then false else events.live_commission_enabled end,
      mercadopago_enabled=case when events.live_mode is distinct from excluded.live_mode then false else events.mercadopago_enabled end,
      live_mode=excluded.live_mode,online_enabled=excluded.online_enabled,slug=excluded.slug;
  insert into actv_payments.event_operation_audit(event_id,actor,before_state,after_state)
    select p_event_id,auth.uid(),v_before,jsonb_build_object('event',to_jsonb(ev),'configuration',to_jsonb(cfg))
      from public.eventos ev join actv_payments.events cfg on cfg.event_id=ev.id where ev.id=p_event_id;
  return jsonb_build_object('event_id',p_event_id);
end $$;

create or replace function public.actv_configure_event(p_event_id uuid,p_online_enabled boolean,
  p_reader_id text default null,p_slug text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.eventos; c actv_payments.events; v_values jsonb;
begin
  perform public.actv_organizer(auth.uid(),p_event_id);
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,12600));
  select * into strict e from public.eventos where id=p_event_id for update;
  select * into strict c from actv_payments.events where event_id=p_event_id for update;
  v_values:=jsonb_build_object('name',e.nombre_carrera,'date',e.fecha,'capacity',e.cupo_maximo,
    'price',e.precio_1,'package_name',e.nombre_precio_1,'price2',e.precio_2,'package_name2',e.nombre_precio_2,
    'distance',e.distancia,'description',e.descripcion,'image',to_jsonb(e)->>'imagen_evento',
    'slug',coalesce(p_slug,c.slug),'live_mode',c.live_mode,'online_enabled',p_online_enabled);
  if p_reader_id is not null then v_values:=v_values||jsonb_build_object('reader_id',p_reader_id); end if;
  perform public.actv_operations_save_event(p_event_id,v_values);
  return public.actv_organizer(auth.uid(),p_event_id);
end $$;

-- Retire direct legacy event writers; both event surfaces use the same contract.
revoke insert,update,delete on public.eventos from public,anon,authenticated;
-- Old creators silently selected the test environment. New and stale clients
-- must use the explicit-environment creation contract instead.
revoke all on function public.actv_create_organizer_event(text,date,text,integer,integer),
  public.actv_create_organizer_event(text,date,text,integer,integer,text) from public,anon,authenticated;
revoke all on function actv_payments.can_operate_event(uuid,uuid),public.actv_operations_context(),
  public.actv_operations_event(uuid),public.actv_operations_events(text,integer,integer),public.actv_operations_roster(uuid,text,integer,integer,text,text),
  public.actv_operations_athletes(text,integer,integer),public.actv_operations_save_event(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.actv_operations_athlete_duplicate(text,text,text) from public,anon,authenticated;
revoke all on function public.actv_operations_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.actv_operations_context(),public.actv_operations_event(uuid),public.actv_operations_events(text,integer,integer),
  public.actv_operations_roster(uuid,text,integer,integer,text,text),public.actv_operations_athletes(text,integer,integer),
  public.actv_operations_save_event(uuid,jsonb) to authenticated;
grant execute on function public.actv_operations_athlete_duplicate(text,text,text) to authenticated;
grant execute on function public.actv_operations_history(uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;

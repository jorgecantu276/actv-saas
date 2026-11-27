begin;
create or replace function public.actv_operations_roster(p_event_id uuid,p_query text default '',p_offset integer default 0,
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
    select r.*,s.effective->'participant' as participant,s.effective->'event' as snapshot_event,coalesce(a.present,false) as attended,actv_payments.registration_entry_allowed(r.id) as entry_allowed,
      s.revision,s.provenance from public.inscripciones r
    join actv_payments.registration_snapshots s on s.registration_id=r.id
    left join actv_payments.attendance_state a on a.registration_id=r.id where r.evento_id=p_event_id
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
      'actv_eligible',actv_eligible,'entry_allowed',entry_allowed,'attended',attended,'atletas',participant,'revision',revision,'provenance',provenance,
      'eventos',jsonb_build_object('nombre_carrera',snapshot_event->>'name','fecha',snapshot_event->>'date'),
      'perfiles',case when v_sell then (select jsonb_build_object('nombre_completo',nombre_completo) from public.perfiles where id=usuario_id) end)
      order by ord) from paged),'[]'::jsonb),
    (select jsonb_build_object('registrations',count(*),'eligible',count(*) filter(where entry_allowed),
      'legacy_unknown',count(*) filter(where actv_eligible is null),'ineligible',count(*) filter(where not entry_allowed),
      'kits',count(*) filter(where kit_entregado),'attended',count(*) filter(where attended)) from records)
    into v_total,v_rows,v_stats;
  return jsonb_build_object('rows',v_rows,'total',v_total,'stats',v_stats,'can_sell',v_sell,
    'can_record',coalesce(actv_payments.lifecycle(p_event_id)->>'phase','active')<>'cancelled' and (select fecha <= (now() at time zone 'America/Matamoros')::date from public.eventos where id=p_event_id));
end $$;

create or replace function public.actv_operations_history(p_athlete_id uuid,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if actv_payments.role(auth.uid()) is null then raise exception 'Personal requerido' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Página inválida' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from public.inscripciones r where r.atleta_id=p_athlete_id
      and actv_payments.can_sell(auth.uid(),r.evento_id)),
    'rows',coalesce((select jsonb_agg(x.value order by x.fecha desc,x.id) from (
      select r.id,e.fecha,to_jsonb(r)||jsonb_build_object('attended',coalesce((select present from actv_payments.attendance_state where registration_id=r.id),false),'entry_allowed',actv_payments.registration_entry_allowed(r.id),'atletas',s.effective->'participant',
        'eventos',jsonb_build_object('nombre_carrera',s.effective->'event'->>'name','fecha',s.effective->'event'->>'date'),
        'perfiles',(select jsonb_build_object('nombre_completo',nombre_completo) from public.perfiles where id=r.usuario_id)) as value
      from public.inscripciones r join actv_payments.registration_snapshots s on s.registration_id=r.id
        join public.eventos e on e.id=r.evento_id where r.atleta_id=p_athlete_id and actv_payments.can_sell(auth.uid(),r.evento_id)
      order by e.fecha desc,r.id offset p_offset limit p_limit) x),'[]'::jsonb));
end $$;

create or replace function public.actv_kit_evidence(p_operator uuid,p_registration uuid,p_request uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$
declare r public.inscripciones; e actv_payments.kit_evidence; path text; begin
  perform pg_advisory_xact_lock(20261126,12100);
  select * into r from public.inscripciones where id=p_registration for update;
  if r.id is null then raise no_data_found; end if;
  if not actv_payments.can_sell(p_operator,r.evento_id) then raise insufficient_privilege; end if;
  if p_action='view' then
    select * into e from actv_payments.kit_evidence where registration_id=r.id and state='committed';
    if e.id is null then raise no_data_found using message='Evidence reference requires origin-approved adoption'; end if;
    return jsonb_build_object('id',e.id,'path',e.object_path,'state',e.state,'actor',e.actor_id,'committed_at',e.committed_at,'legacy',e.legacy,'legal_hold',e.legal_hold);
  end if;
  if p_action not in ('reserve','finalize','status') or p_request is null then raise invalid_parameter_value; end if;
  select * into e from actv_payments.kit_evidence where id=p_request for update;
  if e.id is not null and (e.registration_id<>r.id or e.actor_id is distinct from p_operator) then raise insufficient_privilege; end if;
  if p_action='reserve' and e.id is null then
    if coalesce(r.kit_entregado,false) or not actv_payments.registration_entry_allowed(r.id) then raise check_violation using message='Registration unavailable'; end if;
    path:=r.evento_id::text||'/'||r.id::text||'/'||p_request::text||'.jpg';
    insert into actv_payments.kit_evidence(id,registration_id,event_id,object_path,actor_id,requested_at,state)
    values(p_request,r.id,r.evento_id,path,p_operator,now(),'reserved') returning * into e;
  end if;
  if e.id is null then raise no_data_found; end if;
  if p_action='finalize' and e.state='reserved' then
    if coalesce(r.kit_entregado,false) or not actv_payments.registration_entry_allowed(r.id) then
      update actv_payments.kit_evidence set state='rejected' where id=e.id returning * into e;
    else
      if not exists(select 1 from storage.objects where bucket_id='evidencias_kits' and name=e.object_path) then
        raise check_violation using message='Evidence upload required';
      end if;
      update public.inscripciones set kit_entregado=true,foto_evidencia='actv-evidence:'||e.id::text where id=r.id;
      update actv_payments.kit_evidence set state='committed',committed_at=now() where id=e.id returning * into e;
    end if;
  end if;
  return jsonb_build_object('id',e.id,'path',e.object_path,'state',e.state,'actor',e.actor_id,'committed_at',e.committed_at);
end $$;


create or replace function public.actv_organizer_attendance(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not actv_payments.can_record_attendance(auth.uid(),p_event_id) then raise insufficient_privilege; end if;
  return (select jsonb_build_object('sales',count(*),'attended',count(*) filter(where coalesce(a.present,false)),
    'can_record',coalesce(actv_payments.lifecycle(p_event_id)->>'phase','active')<>'cancelled'
      and (select fecha<=(now() at time zone 'America/Matamoros')::date from public.eventos where id=p_event_id),
    'registrations',coalesce(jsonb_agg(jsonb_build_object('registration_id',r.id,'folio',r.folio_asignado,
      'name',concat_ws(' ',s.effective#>>'{participant,nombre}',s.effective#>>'{participant,apellido}'),
      'attended',coalesce(a.present,false),'entry_allowed',actv_payments.registration_entry_allowed(r.id)) order by r.folio_asignado),'[]'::jsonb))
    from public.inscripciones r join actv_payments.registration_snapshots s on s.registration_id=r.id
    left join actv_payments.attendance_state a on a.registration_id=r.id
    where r.evento_id=p_event_id and r.folio_asignado is not null);
end $$;

notify pgrst,'reload schema';
commit;

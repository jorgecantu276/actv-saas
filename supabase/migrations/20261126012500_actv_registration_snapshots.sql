begin;

-- Acceptance records are distinct from mutable athlete profiles. Missing old
-- acceptance/consent is never manufactured from today's profile values.
create table actv_payments.registration_policies (
  event_id uuid primary key references public.eventos(id),
  required_fields text[] not null,
  notice_version text, notice_text text, waiver_version text, waiver_text text,
  revision integer not null default 1,
  configured_by uuid not null references auth.users(id),
  configured_at timestamptz not null default now()
);
create table actv_payments.registration_policy_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.eventos(id), actor uuid not null references auth.users(id),
  happened_at timestamptz not null default now(), before_state jsonb, after_state jsonb not null
);
alter table actv_payments.orders add column acceptance_context jsonb;
alter table actv_payments.items add column accepted_snapshot jsonb;
create table actv_payments.registration_snapshots (
  registration_id uuid primary key references public.inscripciones(id),
  original jsonb, effective jsonb not null,
  revision integer not null default 0,
  provenance text not null check(provenance in ('accepted_order','retained_order_partial','legacy_observed_at_upgrade'))
);
create table actv_payments.registration_corrections (
  request_id uuid primary key,
  registration_id uuid not null references public.inscripciones(id),
  actor uuid not null references auth.users(id), happened_at timestamptz not null default now(),
  expected_revision integer not null, revision integer not null,
  reason text not null, patch jsonb not null, before_state jsonb not null, after_state jsonb not null,
  unique(registration_id,revision)
);
alter table actv_payments.registration_policies enable row level security;
alter table actv_payments.registration_policy_audit enable row level security;
alter table actv_payments.registration_snapshots enable row level security;
alter table actv_payments.registration_corrections enable row level security;
revoke all on actv_payments.registration_policies,actv_payments.registration_policy_audit,
  actv_payments.registration_snapshots,actv_payments.registration_corrections from public,anon,authenticated,service_role;

create function actv_payments.registration_policy(p_event uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('required_fields',coalesce(p.required_fields,array[
    'nombre','apellido','telefono','telefono_emergencia','talla_playera']),
    'notice_version',p.notice_version,'notice_text',p.notice_text,
    'waiver_version',p.waiver_version,'waiver_text',p.waiver_text,
    'revision',coalesce(p.revision,0),'configured_at',p.configured_at)
  from (select p_event as event_id) e left join actv_payments.registration_policies p using(event_id)
$$;

create function actv_payments.registration_participant(p_source jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_object_agg(k,case when jsonb_typeof(p_source->k)='string' then to_jsonb(nullif(btrim(p_source->>k),'')) else 'null'::jsonb end)
  from unnest(array['nombre','apellido','telefono','telefono_emergencia','talla_playera',
    'fecha_nacimiento','genero','ciudad','club','email']) k
$$;

create function actv_payments.validate_registration_participant(p_participant jsonb,p_required text[]) returns void
language plpgsql set search_path='' as $$
declare k text; v text; maximum integer; begin
  if jsonb_typeof(p_participant) is distinct from 'object' then
    raise exception 'Datos del participante inválidos' using errcode='22023'; end if;
  foreach k in array array['nombre','apellido','telefono','telefono_emergencia','talla_playera',
    'fecha_nacimiento','genero','ciudad','club','email'] loop
    v:=nullif(btrim(p_participant->>k),'');
    maximum:=case when k in ('nombre','apellido','ciudad') then 100 when k='club' then 120 when k='email' then 254 else 30 end;
    if (p_participant ? k and jsonb_typeof(p_participant->k) not in ('string','null'))
      or length(v)>maximum or (k=any(p_required) and v is null)
      or (k in ('telefono','telefono_emergencia') and v is not null and length(v)<7)
      or (k='email' and v is not null and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'Revisa el campo % del participante',k using errcode='22023'; end if;
    if k='fecha_nacimiento' and v is not null then
      begin
        if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v::date>current_date then raise invalid_datetime_format; end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Fecha de nacimiento inválida' using errcode='22023';
      end;
    end if;
  end loop;
end $$;

create function actv_payments.registration_can_read(p_actor uuid,p_event uuid) returns boolean
language sql stable set search_path='' as $$
  select actv_payments.can_sell(p_actor,p_event) or exists(
    select 1 from actv_payments.events e join actv_payments.members m on m.organizer_id=e.organizer_id
    where e.event_id=p_event and m.user_id=p_actor)
$$;

create function public.actv_set_registration_policy(p_event_id uuid,p_required_fields text[],
  p_notice_version text default null,p_waiver_version text default null,
  p_notice_text text default null,p_waiver_text text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare fields text[]; before_value jsonb; begin
  perform pg_advisory_xact_lock(20261126,12100);
  if not actv_payments.is_manager(auth.uid()) then raise insufficient_privilege; end if;
  perform 1 from public.eventos where id=p_event_id for update;
  if not found then raise exception 'Evento no disponible' using errcode='22023'; end if;
  if p_required_fields is null or exists(select 1 from unnest(p_required_fields) k
    where k is null or k<>all(array['nombre','apellido','telefono','telefono_emergencia','talla_playera','fecha_nacimiento','genero','ciudad','club','email']))
    or (p_notice_version is null)<>(p_notice_text is null) or (p_waiver_version is null)<>(p_waiver_text is null)
    or (p_notice_version is not null and (length(btrim(p_notice_version)) not between 1 and 100 or length(btrim(p_notice_text)) not between 1 and 20000))
    or (p_waiver_version is not null and (length(btrim(p_waiver_version)) not between 1 and 100 or length(btrim(p_waiver_text)) not between 1 and 20000)) then
    raise exception 'Revisa los campos y documentos de inscripción' using errcode='22023'; end if;
  select array_agg(distinct k order by k) into fields from unnest(p_required_fields||array[
    'nombre','apellido','telefono','telefono_emergencia','talla_playera']) k;
  select to_jsonb(p) into before_value from actv_payments.registration_policies p where event_id=p_event_id;
  insert into actv_payments.registration_policies(event_id,required_fields,notice_version,notice_text,waiver_version,waiver_text,configured_by)
    values(p_event_id,fields,btrim(p_notice_version),btrim(p_notice_text),btrim(p_waiver_version),btrim(p_waiver_text),auth.uid())
  on conflict(event_id) do update set required_fields=excluded.required_fields,notice_version=excluded.notice_version,
    notice_text=excluded.notice_text,waiver_version=excluded.waiver_version,waiver_text=excluded.waiver_text,
    revision=registration_policies.revision+1,configured_by=excluded.configured_by,configured_at=now();
  insert into actv_payments.registration_policy_audit(event_id,actor,before_state,after_state)
    select p_event_id,auth.uid(),before_value,to_jsonb(p) from actv_payments.registration_policies p where event_id=p_event_id;
  return actv_payments.registration_policy(p_event_id);
end $$;

-- Preserve the catalog's exact publication rules while attaching the policy.
alter function public.actv_catalog(uuid,text) rename to catalog_before_registration_snapshots;
alter function public.catalog_before_registration_snapshots(uuid,text) set schema actv_payments;
create function public.actv_catalog(p_event_id uuid default null,p_slug text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select c||jsonb_build_object('registration_policy',actv_payments.registration_policy((c->>'event_id')::uuid))
  from (select actv_payments.catalog_before_registration_snapshots(p_event_id,p_slug) c) x where c is not null
$$;
create function public.actv_registration_policy(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not actv_payments.registration_can_read(auth.uid(),p_event_id)
    and actv_payments.catalog_before_registration_snapshots(p_event_id,null) is null then
    raise insufficient_privilege; end if;
  return actv_payments.registration_policy(p_event_id);
end $$;

create function actv_payments.snapshot_order_acceptance() returns trigger
language plpgsql set search_path='' as $$
declare e public.eventos; begin
  select * into strict e from public.eventos where id=new.event_id;
  new.acceptance_context:=jsonb_build_object('event',jsonb_build_object('id',e.id,'name',e.nombre_carrera,
    'date',e.fecha,'distance',e.distancia),'policy',actv_payments.registration_policy(e.id),'accepted_at',clock_timestamp());
  return new;
end $$;
create trigger actv_snapshot_order before insert on actv_payments.orders
for each row execute function actv_payments.snapshot_order_acceptance();

create function actv_payments.snapshot_item_acceptance() returns trigger
language plpgsql set search_path='' as $$
declare o actv_payments.orders; a public.atletas; raw jsonb; participant jsonb; policy jsonb; consent jsonb; required text[]; begin
  select * into strict o from actv_payments.orders where id=new.order_id;
  raw:=o.original_items->(new.number-1);
  if o.channel='online' then participant:=raw;
  else
    select * into strict a from public.atletas where id=new.athlete_id for share;
    participant:=to_jsonb(a);
  end if;
  policy:=o.acceptance_context->'policy';
  select array_agg(value) into required from jsonb_array_elements_text(policy->'required_fields');
  perform actv_payments.validate_registration_participant(participant,required);
  participant:=actv_payments.registration_participant(participant);
  consent:=coalesce(raw->'consent','{}'::jsonb);
  if jsonb_typeof(consent) is distinct from 'object' then raise exception 'Consentimiento inválido' using errcode='22023'; end if;
  if ((policy->>'notice_version' is not null or policy->>'waiver_version' is not null)
      and consent->'policy_revision' is distinct from policy->'revision')
    or (policy->>'notice_version' is not null and (consent->>'notice_version' is distinct from policy->>'notice_version' or consent->'notice_accepted' is distinct from 'true'::jsonb))
    or (policy->>'waiver_version' is not null and (consent->>'waiver_version' is distinct from policy->>'waiver_version' or consent->'waiver_accepted' is distinct from 'true'::jsonb)) then
    raise exception 'Confirma los documentos vigentes para cada participante' using errcode='22023'; end if;
  consent:=jsonb_build_object('status',case when policy->>'notice_version' is null and policy->>'waiver_version' is null then 'unknown' else 'accepted' end,
    'notice_version',policy->'notice_version','notice_text',policy->'notice_text',
    'notice_accepted',case when policy->>'notice_version' is not null then true end,
    'waiver_version',policy->'waiver_version','waiver_text',policy->'waiver_text',
    'waiver_accepted',case when policy->>'waiver_version' is not null then true end,
    'recorded_at',o.acceptance_context->'accepted_at','actor',o.operator,'channel',o.channel);
  new.participant:=participant;
  new.accepted_snapshot:=jsonb_build_object('participant',participant,
    'package',jsonb_build_object('number',(raw->>'package')::integer,'name',new.name,'amount_minor',new.amount),
    'event',o.acceptance_context->'event','consent',consent,'accepted_at',o.acceptance_context->'accepted_at',
    'channel',o.channel,'policy_revision',policy->'revision','required_fields',policy->'required_fields');
  return new;
end $$;
create trigger actv_snapshot_item before insert on actv_payments.items
for each row execute function actv_payments.snapshot_item_acceptance();

create function actv_payments.guard_accepted_snapshot() returns trigger
language plpgsql set search_path='' as $$ begin
  if tg_table_name='orders' then
    if new.acceptance_context is distinct from old.acceptance_context then raise check_violation using message='Aceptación inmutable'; end if;
  elsif (new.accepted_snapshot,new.participant,new.name,new.amount,new.order_id,new.number)
    is distinct from (old.accepted_snapshot,old.participant,old.name,old.amount,old.order_id,old.number) then
    raise check_violation using message='Participante y compra aceptados son inmutables';
  end if;
  return new;
end $$;
create trigger actv_immutable_order_acceptance before update on actv_payments.orders
for each row execute function actv_payments.guard_accepted_snapshot();
create trigger actv_immutable_item_acceptance before update on actv_payments.items
for each row execute function actv_payments.guard_accepted_snapshot();

create function actv_payments.attach_registration_snapshot() returns trigger
language plpgsql set search_path='' as $$
declare accepted jsonb; observed jsonb; source text; participant jsonb; e public.eventos; item actv_payments.items; begin
  select * into e from public.eventos where id=new.evento_id;
  select * into item from actv_payments.items where id=new.actv_order_item_id;
  accepted:=item.accepted_snapshot;
  if accepted is not null then source:='accepted_order'; observed:=accepted;
  else
    select actv_payments.registration_participant(to_jsonb(a)) into participant from public.atletas a where a.id=new.atleta_id;
    observed:=jsonb_build_object('participant',participant,'package',jsonb_build_object('number',null,'name',new.paquete_comprado,'amount_minor',new.monto_pagado*100),
      'event',jsonb_build_object('id',new.evento_id,'name',e.nombre_carrera,'date',e.fecha,'distance',e.distancia),
      'consent',jsonb_build_object('status','unknown'),'accepted_at',null,'channel',new.metodo_pago,'policy_revision',null);
    source:='legacy_observed_at_upgrade';
    if item.id is not null then
      source:='retained_order_partial';
      accepted:=jsonb_build_object('participant',item.participant,'package',jsonb_build_object('number',null,'name',item.name,'amount_minor',item.amount),
        'event',jsonb_build_object('id',new.evento_id,'name',null,'date',null,'distance',null),
        'consent',jsonb_build_object('status','unknown'),'accepted_at',null,'policy_revision',null);
      -- Online retained items contain actual accepted fields; prefer them to
      -- current profile values while leaving unrecorded facts explicitly unknown.
      if item.participant is not null then observed:=jsonb_set(observed,'{participant}',actv_payments.registration_participant(item.participant)); end if;
    end if;
  end if;
  insert into actv_payments.registration_snapshots(registration_id,original,effective,provenance)
    values(new.id,accepted,observed,source);
  return new;
end $$;
create trigger actv_registration_snapshot after insert on public.inscripciones
for each row execute function actv_payments.attach_registration_snapshot();

-- Retain every legacy row, including registrations whose athlete reference is
-- unknown. These effective values are explicitly observed at upgrade, never
-- represented as historical acceptance evidence.
insert into actv_payments.registration_snapshots(registration_id,original,effective,provenance)
select r.id,
  case when i.id is not null then jsonb_build_object('participant',i.participant,
    'package',jsonb_build_object('number',null,'name',i.name,'amount_minor',i.amount),
    'event',jsonb_build_object('id',r.evento_id,'name',null,'date',null,'distance',null),
    'consent',jsonb_build_object('status','unknown'),'accepted_at',null,'policy_revision',null) end,
  jsonb_build_object('participant',actv_payments.registration_participant(coalesce(i.participant,to_jsonb(a))),
    'package',jsonb_build_object('number',null,'name',r.paquete_comprado,'amount_minor',r.monto_pagado*100),
    'event',jsonb_build_object('id',r.evento_id,'name',e.nombre_carrera,'date',e.fecha,'distance',e.distancia),
    'consent',jsonb_build_object('status','unknown'),'accepted_at',null,'channel',r.metodo_pago,'policy_revision',null),
  case when i.id is not null then 'retained_order_partial' else 'legacy_observed_at_upgrade' end
from public.inscripciones r left join public.atletas a on a.id=r.atleta_id
  left join public.eventos e on e.id=r.evento_id left join actv_payments.items i on i.id=r.actv_order_item_id;

create function actv_payments.registration_record(p_registration uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('registration_id',r.id,'event_id',r.evento_id,'revision',s.revision,
    'original',s.original,'effective',s.effective,'provenance',s.provenance,'consent',s.effective->'consent',
    'can_correct',actv_payments.is_manager(auth.uid()),
    'corrections',coalesce((select jsonb_agg(jsonb_build_object('request_id',c.request_id,'actor',c.actor,
      'happened_at',c.happened_at,'reason',c.reason,'revision',c.revision,'before',c.before_state,'after',c.after_state)
      order by c.revision) from actv_payments.registration_corrections c where c.registration_id=r.id),'[]'::jsonb))
  from public.inscripciones r join actv_payments.registration_snapshots s on s.registration_id=r.id where r.id=p_registration
$$;
create function public.actv_registration_record(p_registration_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare event uuid; begin
  select evento_id into event from public.inscripciones where id=p_registration_id;
  if event is null or not actv_payments.registration_can_read(auth.uid(),event) then raise insufficient_privilege; end if;
  return actv_payments.registration_record(p_registration_id);
end $$;

create function public.actv_correct_registration(p_registration_id uuid,p_expected_revision integer,p_request_id uuid,p_patch jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s actv_payments.registration_snapshots; prior actv_payments.registration_corrections; after_value jsonb; participant jsonb; required text[]; begin
  perform pg_advisory_xact_lock(20261126,12100);
  if not actv_payments.is_manager(auth.uid()) then raise insufficient_privilege; end if;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_reason is null or length(btrim(p_reason)) not between 5 and 1000
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['nombre','apellido','telefono','telefono_emergencia','talla_playera','fecha_nacimiento','genero','ciudad','club','email'])) then
    raise exception 'Corrección inválida: conserva identidad, paquete, importe y folio' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12500));
  select * into prior from actv_payments.registration_corrections where request_id=p_request_id;
  if found then
    if (prior.registration_id,prior.actor,prior.expected_revision,prior.patch,prior.reason)
      is distinct from (p_registration_id,auth.uid(),p_expected_revision,p_patch,btrim(p_reason)) then
      raise exception 'La solicitud ya pertenece a otra corrección' using errcode='23514'; end if;
    return actv_payments.registration_record(p_registration_id)||jsonb_build_object('applied_revision',prior.revision);
  end if;
  perform 1 from public.inscripciones where id=p_registration_id for update;
  select * into s from actv_payments.registration_snapshots where registration_id=p_registration_id for update;
  if not found then raise no_data_found; end if;
  if s.revision<>p_expected_revision then raise exception 'La inscripción cambió; vuelve a consultarla' using errcode='23514'; end if;
  participant:=s.effective->'participant'||p_patch;
  if s.provenance='accepted_order' then
    select array_agg(value) into required from jsonb_array_elements_text(s.original->'required_fields');
    perform actv_payments.validate_registration_participant(participant,required);
  else
    -- Unknown legacy values may remain unknown. Validate only the requested
    -- correction, rather than demanding newly invented missing evidence.
    select array_agg(k) into required from jsonb_object_keys(p_patch) k
      where k=any(array['nombre','apellido','telefono','telefono_emergencia','talla_playera']);
    perform actv_payments.validate_registration_participant(p_patch,coalesce(required,'{}'::text[]));
  end if;
  after_value:=jsonb_set(s.effective,'{participant}',actv_payments.registration_participant(participant));
  if after_value=s.effective then raise exception 'No hay cambios para registrar' using errcode='22023'; end if;
  insert into actv_payments.registration_corrections(request_id,registration_id,actor,expected_revision,revision,reason,patch,before_state,after_state)
    values(p_request_id,p_registration_id,auth.uid(),p_expected_revision,s.revision+1,btrim(p_reason),p_patch,s.effective,after_value);
  update actv_payments.registration_snapshots set effective=after_value,revision=revision+1 where registration_id=p_registration_id;
  return actv_payments.registration_record(p_registration_id)||jsonb_build_object('applied_revision',s.revision+1);
end $$;

create function actv_payments.guard_registration_audit() returns trigger language plpgsql set search_path='' as $$ begin
  raise exception 'El historial de aceptación/corrección es inmutable' using errcode='42501';
end $$;
create trigger actv_registration_corrections_immutable before update or delete on actv_payments.registration_corrections
for each row execute function actv_payments.guard_registration_audit();
create trigger actv_registration_policy_audit_immutable before update or delete on actv_payments.registration_policy_audit
for each row execute function actv_payments.guard_registration_audit();
create function actv_payments.guard_registration_overlay() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' then raise insufficient_privilege; end if;
  if (new.registration_id,new.original,new.provenance) is distinct from (old.registration_id,old.original,old.provenance)
    or new.revision<>old.revision+1 or not exists(select 1 from actv_payments.registration_corrections c
      where c.registration_id=old.registration_id and c.revision=new.revision and c.before_state=old.effective and c.after_state=new.effective) then
    raise exception 'Usa la corrección auditada de inscripción' using errcode='42501'; end if;
  return new;
end $$;
create trigger actv_registration_overlay_guard before update or delete on actv_payments.registration_snapshots
for each row execute function actv_payments.guard_registration_overlay();

revoke all on all functions in schema actv_payments from public,anon,authenticated;
revoke all on function public.actv_set_registration_policy(uuid,text[],text,text,text,text),
  public.actv_registration_policy(uuid),public.actv_registration_record(uuid),
  public.actv_correct_registration(uuid,integer,uuid,jsonb,text),public.actv_catalog(uuid,text) from public,anon,authenticated;
grant execute on function public.actv_catalog(uuid,text),public.actv_registration_policy(uuid) to anon,authenticated,service_role;
grant execute on function public.actv_set_registration_policy(uuid,text[],text,text,text,text),public.actv_registration_record(uuid),
  public.actv_correct_registration(uuid,integer,uuid,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;

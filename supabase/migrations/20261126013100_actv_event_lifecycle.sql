begin;

create table actv_payments.event_lifecycle(
 event_id uuid primary key references public.eventos,
 phase text not null default 'scheduled' check(phase in ('scheduled','postponed','cancelled')),
 sales_paused boolean not null default false, revision integer not null default 0,
 public_message text not null default '', changed_at timestamptz not null default now()
);
create table actv_payments.event_lifecycle_audit(
 request_id uuid primary key,event_id uuid not null references public.eventos,
 actor uuid not null references auth.users,action text not null,reason text not null,
 requested jsonb not null,before_state jsonb not null,after_state jsonb not null,
 recorded_at timestamptz not null default now()
);
revoke all on actv_payments.event_lifecycle,actv_payments.event_lifecycle_audit from public,anon,authenticated,service_role;
create trigger actv_event_lifecycle_audit_immutable before update or delete on actv_payments.event_lifecycle_audit
 for each row execute function actv_payments.guard_registration_audit();

create function actv_payments.lifecycle(p_event uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('event_id',e.id,'phase',coalesce(l.phase,'scheduled'),
 'sales_paused',coalesce(l.sales_paused,false),'revision',coalesce(l.revision,0),
 'public_message',coalesce(l.public_message,''),'operational_date',e.fecha)
 from public.eventos e left join actv_payments.event_lifecycle l on l.event_id=e.id where e.id=p_event
$$;
create function public.actv_event_lifecycle(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 if not actv_payments.can_operate_event(auth.uid(),p_event_id) then raise insufficient_privilege; end if;
 return actv_payments.lifecycle(p_event_id)||jsonb_build_object('can_manage',actv_payments.is_manager(auth.uid()));
end $$;
create function public.actv_transition_event(p_event_id uuid,p_expected_revision integer,p_request_id uuid,
 p_action text,p_reason text,p_public_message text,p_new_date date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_state jsonb; new_state jsonb; requested jsonb; prior actv_payments.event_lifecycle_audit;
begin
 perform pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.is_manager(auth.uid()) then raise insufficient_privilege; end if;
 if p_request_id is null or p_expected_revision is null or p_action is null or p_action not in ('pause','resume','postpone','cancel')
 or p_reason is null or length(btrim(p_reason)) not between 10 and 500
 or p_public_message is null or length(p_public_message)>1000 then raise exception 'Revisa la transición y el motivo' using errcode='22023'; end if;
 requested:=jsonb_build_object('revision',p_expected_revision,'action',p_action,'reason',btrim(p_reason),'message',p_public_message,'date',p_new_date);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,13100));
 select * into prior from actv_payments.event_lifecycle_audit where request_id=p_request_id;
 if found then
  if (prior.event_id,prior.actor,prior.requested) is distinct from (p_event_id,auth.uid(),requested) then
   raise exception 'Solicitud diferente' using errcode='23514'; end if;
  return prior.after_state;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,12600));
 perform from public.eventos where id=p_event_id for update;
 if not found then raise exception 'Evento no disponible' using errcode='22023'; end if;
 old_state:=actv_payments.lifecycle(p_event_id);
 if (old_state->>'revision')::integer<>p_expected_revision or old_state->>'phase'='cancelled' then
  raise exception 'Actualiza el evento; una cancelación es definitiva' using errcode='23514'; end if;
 if p_action='postpone' then
  if p_new_date is null or p_new_date<(now() at time zone 'America/Matamoros')::date or p_new_date>(now() at time zone 'America/Matamoros')::date+3650 then
   raise exception 'Nueva fecha inválida' using errcode='22023'; end if;
  update public.eventos set fecha=p_new_date where id=p_event_id;
 elsif p_new_date is not null then raise exception 'Fecha solo para aplazamiento' using errcode='22023'; end if;
 insert into actv_payments.event_lifecycle(event_id,phase,sales_paused,revision,public_message)
 values(p_event_id,case when p_action='cancel' then 'cancelled' when p_action='postpone' then 'postponed' else old_state->>'phase' end,
 p_action<>'resume',p_expected_revision+1,p_public_message)
 on conflict(event_id) do update set phase=excluded.phase,sales_paused=excluded.sales_paused,
 revision=excluded.revision,public_message=excluded.public_message,changed_at=now();
 new_state:=actv_payments.lifecycle(p_event_id);
 insert into actv_payments.event_lifecycle_audit values(p_request_id,p_event_id,auth.uid(),p_action,btrim(p_reason),requested,old_state,new_state,now());
 return new_state;
end $$;

create function actv_payments.guard_lifecycle_order() returns trigger language plpgsql set search_path='' as $$ begin
 perform from public.eventos where id=new.event_id for share;
 if exists(select 1 from actv_payments.event_lifecycle where event_id=new.event_id and sales_paused) then
  raise exception 'Las ventas de esta carrera están pausadas' using errcode='23514'; end if;
 return new;
end $$;
create trigger actv_lifecycle_order before insert on actv_payments.orders for each row execute function actv_payments.guard_lifecycle_order();

alter function public.actv_public_races(boolean) set schema actv_payments;
alter function actv_payments.actv_public_races(boolean) rename to public_races_before_lifecycle;
create function public.actv_public_races(p_live_mode boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(r.value),'[]'::jsonb)
 from jsonb_array_elements(actv_payments.public_races_before_lifecycle(p_live_mode)) r(value)
 where not exists(select 1 from actv_payments.event_lifecycle l where l.event_id=(r.value->>'event_id')::uuid and l.sales_paused)
$$;
revoke all on function actv_payments.public_races_before_lifecycle(boolean) from public,anon,authenticated;
revoke all on function public.actv_public_races(boolean) from public,anon,authenticated;
grant execute on function public.actv_public_races(boolean) to anon,authenticated;
alter function public.actv_catalog(uuid,text) set schema actv_payments;
alter function actv_payments.actv_catalog(uuid,text) rename to catalog_before_lifecycle;
create function public.actv_catalog(p_event_id uuid default null,p_slug text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare value jsonb; begin
 value:=actv_payments.catalog_before_lifecycle(p_event_id,p_slug);
 if exists(select 1 from actv_payments.event_lifecycle l where l.event_id=(value->>'event_id')::uuid and l.sales_paused) then return null; end if;
 return value;
end $$;
revoke all on function public.actv_catalog(uuid,text) from public,anon,authenticated;
grant execute on function public.actv_catalog(uuid,text) to service_role;

alter function public.actv_authorize_provider_attempt(uuid,text,text) set schema actv_payments;
alter function actv_payments.actv_authorize_provider_attempt(uuid,text,text) rename to authorize_provider_before_lifecycle;
create function public.actv_authorize_provider_attempt(p_order_id uuid,p_kind text,p_attempt text) returns boolean
language plpgsql security definer set search_path='' as $$ declare event uuid; begin
 select event_id into strict event from actv_payments.orders where id=p_order_id;
 perform from public.eventos where id=event for share;
 if exists(select 1 from actv_payments.event_lifecycle where event_id=event and sales_paused)
 and not exists(select 1 from actv_payments.provider_attempts where order_id=p_order_id and kind=p_kind and attempt=p_attempt) then
 raise exception 'Las ventas de esta carrera están pausadas' using errcode='23514'; end if;
 return actv_payments.authorize_provider_before_lifecycle(p_order_id,p_kind,p_attempt);
end $$;
revoke all on function public.actv_authorize_provider_attempt(uuid,text,text) from public,anon,authenticated;
grant execute on function public.actv_authorize_provider_attempt(uuid,text,text) to service_role;

alter function actv_payments.refresh_eligibility(uuid) rename to refresh_financial_eligibility;
create function actv_payments.refresh_eligibility(p_order uuid) returns boolean language plpgsql set search_path='' as $$
declare o actv_payments.orders; ok boolean; begin
 select * into strict o from actv_payments.orders where id=p_order for update;
 perform from public.eventos where id=o.event_id for share;
 ok:=actv_payments.refresh_financial_eligibility(p_order);
 if exists(select 1 from actv_payments.event_lifecycle where event_id=o.event_id and phase='cancelled') then
  update public.inscripciones r set actv_eligible=false from actv_payments.items i where i.order_id=p_order and r.actv_order_item_id=i.id;
  update actv_payments.orders set state='review' where id=p_order and state<>'voided';
  return false;
 end if;
 return ok;
end $$;
alter function actv_payments.issue(uuid) rename to issue_financial;
create function actv_payments.issue(p_order uuid) returns jsonb language plpgsql set search_path='' as $$
declare o actv_payments.orders; begin
 select * into strict o from actv_payments.orders where id=p_order for update;
 perform from public.eventos where id=o.event_id for update;
 if exists(select 1 from actv_payments.event_lifecycle where event_id=o.event_id and phase='cancelled') then
  perform actv_payments.refresh_eligibility(p_order);
  return actv_payments.order_json(p_order);
 end if;
 return actv_payments.issue_financial(p_order);
end $$;

create function actv_payments.registration_entry_allowed(p_registration uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.inscripciones r where r.id=p_registration and r.folio_asignado is not null
 and not exists(select 1 from actv_payments.event_lifecycle l where l.event_id=r.evento_id and l.phase='cancelled')
 and ((r.actv_order_item_id is null and r.actv_eligible is null and r.monto_pagado::text ~ '^[0-9]+([.][0-9]+)?$')
 or exists(select 1 from actv_payments.items i cross join lateral actv_payments.financial_item_state(i.order_id) f
 where i.id=r.actv_order_item_id and f.item_id=i.id and f.eligible)))
$$;
create or replace function actv_payments.participant_linkable(p_registration uuid) returns boolean language sql stable set search_path='' as $$
 select actv_payments.registration_entry_allowed(p_registration) and exists(select 1 from public.inscripciones r where r.id=p_registration
 and ((r.actv_order_item_id is null and r.actv_eligible is null and r.monto_pagado::text ~ '^[0-9]+([.][0-9]+)?$')
 or (r.actv_order_item_id is not null and exists(select 1 from actv_payments.items i join actv_payments.orders o on o.id=i.order_id
 join actv_payments.captures c on c.order_id=o.id and c.amount=o.amount and c.currency=o.currency where i.id=r.actv_order_item_id))))
$$;

create table actv_payments.attendance_state(
 registration_id uuid primary key references public.inscripciones,
 present boolean not null,revision integer not null default 0,
 observed_event_date date,changed_at timestamptz not null default now()
);
insert into actv_payments.attendance_state(registration_id,present) select registration_id,true from actv_payments.attendance;
create table actv_payments.attendance_corrections(
 request_id uuid primary key,registration_id uuid not null references public.inscripciones,
 actor uuid not null references auth.users,reason text not null,expected_revision integer not null,
 before_present boolean not null,after_present boolean not null,recorded_at timestamptz not null default now()
);
revoke all on actv_payments.attendance_state,actv_payments.attendance_corrections from public,anon,authenticated,service_role;
create trigger actv_attendance_corrections_immutable before update or delete on actv_payments.attendance_corrections
 for each row execute function actv_payments.guard_registration_audit();
create trigger actv_original_attendance_immutable before update or delete on actv_payments.attendance
 for each row execute function actv_payments.guard_registration_audit();
create function actv_payments.capture_attendance_state() returns trigger language plpgsql set search_path='' as $$ begin
 insert into actv_payments.attendance_state(registration_id,present,observed_event_date)
 select new.registration_id,true,e.fecha from public.inscripciones r join public.eventos e on e.id=r.evento_id where r.id=new.registration_id
 on conflict(registration_id) do nothing; return new;
end $$;
create trigger actv_capture_attendance_state after insert on actv_payments.attendance for each row execute function actv_payments.capture_attendance_state();

create or replace function public.actv_record_attendance(p_event_id uuid,p_registration_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.can_record_attendance(auth.uid(),p_event_id) then raise insufficient_privilege; end if;
 perform from public.eventos where id=p_event_id and fecha<=(now() at time zone 'America/Matamoros')::date for share;
 if not found then raise exception 'Asistencia no disponible hoy' using errcode='P0002'; end if;
 perform from public.inscripciones where id=p_registration_id and evento_id=p_event_id for update;
 if not found or not actv_payments.registration_entry_allowed(p_registration_id) then
 raise exception 'Folio no vigente' using errcode='P0002'; end if;
 if exists(select 1 from actv_payments.attendance_state where registration_id=p_registration_id and not present) then
 raise exception 'La asistencia requiere una corrección auditada' using errcode='23514'; end if;
 insert into actv_payments.attendance(registration_id,recorded_by) values(p_registration_id,auth.uid()) on conflict do nothing;
 return true;
end $$;
create function public.actv_attendance_history(p_registration_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.inscripciones; begin
 select * into r from public.inscripciones where id=p_registration_id;
 if not actv_payments.can_operate_event(auth.uid(),r.evento_id) and not exists(select 1 from actv_payments.runner_entries where registration_id=r.id and user_id=auth.uid()) then raise insufficient_privilege; end if;
 return jsonb_build_object('registration_id',r.id,'present',coalesce((select present from actv_payments.attendance_state where registration_id=r.id),false),
 'revision',coalesce((select revision from actv_payments.attendance_state where registration_id=r.id),0),
 'original_observation',(select to_jsonb(a) from actv_payments.attendance a where registration_id=r.id),
 'can_correct',actv_payments.is_manager(auth.uid()),'entry_allowed',actv_payments.registration_entry_allowed(r.id),
 'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by recorded_at,request_id) from actv_payments.attendance_corrections c where registration_id=r.id),'[]'::jsonb));
end $$;
create function public.actv_correct_attendance(p_registration_id uuid,p_expected_revision integer,p_request_id uuid,p_present boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.inscripciones; s actv_payments.attendance_state; c actv_payments.attendance_corrections; begin
 perform pg_advisory_xact_lock(20261126,12100);
 if not actv_payments.is_manager(auth.uid()) then raise insufficient_privilege; end if;
 if p_request_id is null or p_expected_revision is null or p_present is null or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then
 raise exception 'Corrección inválida' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,13101));
 select * into c from actv_payments.attendance_corrections where request_id=p_request_id;
 if found then
  if (c.registration_id,c.actor,c.expected_revision,c.after_present,c.reason) is distinct from (p_registration_id,auth.uid(),p_expected_revision,p_present,btrim(p_reason)) then raise exception 'Solicitud diferente' using errcode='23514'; end if;
  return public.actv_attendance_history(p_registration_id);
 end if;
 select * into strict r from public.inscripciones where id=p_registration_id;
 perform from public.eventos where id=r.evento_id and (not p_present or fecha<=(now() at time zone 'America/Matamoros')::date
 or exists(select 1 from actv_payments.attendance a join actv_payments.attendance_state observation using(registration_id)
 left join actv_payments.registration_snapshots snap using(registration_id) where a.registration_id=r.id
 and coalesce(observation.observed_event_date,(snap.original#>>'{event,date}')::date,(snap.effective#>>'{event,date}')::date)
 <=(now() at time zone 'America/Matamoros')::date)) for share;
 if not found then raise exception 'No se confirma asistencia futura' using errcode='23514'; end if;
 perform from public.inscripciones where id=r.id for update;
 insert into actv_payments.attendance_state(registration_id,present) values(r.id,false) on conflict do nothing;
 select * into strict s from actv_payments.attendance_state where registration_id=r.id for update;
 if s.revision<>p_expected_revision then raise exception 'Actualiza la asistencia' using errcode='23514'; end if;
 insert into actv_payments.attendance_corrections values(p_request_id,r.id,auth.uid(),btrim(p_reason),p_expected_revision,s.present,p_present,now());
 update actv_payments.attendance_state set present=p_present,revision=revision+1,changed_at=now() where registration_id=r.id;
 return public.actv_attendance_history(r.id);
end $$;

create or replace function actv_payments.runner_registrations(p_user uuid)
returns table(registration_id uuid,event_id uuid,event_name text,event_date date,folio text,attended boolean,personal boolean,achievement_slug text)
language sql stable set search_path='' as $$
 select r.id,e.id,coalesce(s.effective#>>'{event,name}',e.nombre_carrera),
 case when coalesce(a.present,false) then coalesce(a.observed_event_date,(s.original#>>'{event,date}')::date,(s.effective#>>'{event,date}')::date,e.fecha) else e.fecha end,r.folio_asignado,
 coalesce(a.present,false) and own.registration_id is not null,own.registration_id is not null,own.achievement_slug
 from public.inscripciones r join public.eventos e on e.id=r.evento_id
 left join actv_payments.registration_snapshots s on s.registration_id=r.id
 left join actv_payments.items i on i.id=r.actv_order_item_id left join actv_payments.orders o on o.id=i.order_id
 left join actv_payments.attendance_state a on a.registration_id=r.id
 left join actv_payments.runner_entries own on own.registration_id=r.id and own.user_id=p_user
 where r.folio_asignado is not null and (own.registration_id is not null or (o.channel='online'
 and lower(o.buyer_email)=actv_payments.verified_email(p_user) and exists(select 1 from actv_payments.captures c where c.order_id=o.id)))
$$;
create or replace function public.actv_runner_dashboard() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('registrations',coalesce(jsonb_agg((to_jsonb(r)-'registration_id')||jsonb_build_object(
 'entry_allowed',actv_payments.registration_entry_allowed(r.registration_id),'event_status',actv_payments.lifecycle(r.event_id)->>'phase','event_notice',actv_payments.lifecycle(r.event_id)->>'public_message')
 order by r.event_date desc,r.event_id,r.folio),'[]'::jsonb),'attended_count',count(distinct r.event_id) filter(where r.attended and r.personal))
 from actv_payments.runner_registrations(auth.uid()) r
$$;
create or replace function public.actv_public_achievement(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('event_name',coalesce(s.effective#>>'{event,name}',e.nombre_carrera),'event_date',coalesce(a.observed_event_date,(s.effective#>>'{event,date}')::date,e.fecha))
 from actv_payments.runner_entries own join actv_payments.attendance_state a using(registration_id)
 join public.inscripciones r on r.id=own.registration_id join public.eventos e on e.id=own.event_id
 left join actv_payments.registration_snapshots s on s.registration_id=r.id where own.achievement_slug=p_slug and a.present
$$;

revoke all on all functions in schema actv_payments from public,anon,authenticated;
revoke all on function public.actv_event_lifecycle(uuid),public.actv_transition_event(uuid,integer,uuid,text,text,text,date),
public.actv_attendance_history(uuid),public.actv_correct_attendance(uuid,integer,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.actv_event_lifecycle(uuid),public.actv_transition_event(uuid,integer,uuid,text,text,text,date),
public.actv_attendance_history(uuid),public.actv_correct_attendance(uuid,integer,uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;

begin;

-- A purchaser's contact access and a participant's personal ownership are
-- separate authorities. Raw invitation secrets are never persisted.
create table actv_payments.participant_invitations (
  id uuid primary key,
  registration_id uuid not null references public.inscripciones(id),
  recipient_email text not null check(recipient_email=lower(btrim(recipient_email))),
  token_digest text not null unique check(token_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  verification_method text not null check(verification_method in ('buyer_contact','in_person','purchase_contact')),
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
  revoked_at timestamptz, revoked_by uuid references auth.users(id), revoked_reason text,
  redeemed_at timestamptz, redeemed_by uuid references auth.users(id),
  check((redeemed_at is null)=(redeemed_by is null)),
  check((revoked_at is null)=(revoked_by is null))
);
create unique index actv_one_pending_participant_invitation on actv_payments.participant_invitations(registration_id)
  where revoked_at is null and redeemed_at is null;
create table actv_payments.participant_link_audit (
  id bigint generated always as identity primary key,
  invitation_id uuid references actv_payments.participant_invitations(id),
  registration_id uuid not null references public.inscripciones(id),
  actor uuid not null references auth.users(id), happened_at timestamptz not null default clock_timestamp(),
  action text not null check(action in ('invited','revoked','expired_replacement','linked','legacy_event_adopted')),
  reason text not null, details jsonb not null default '{}'::jsonb
);
alter table actv_payments.participant_invitations enable row level security;
alter table actv_payments.participant_link_audit enable row level security;
revoke all on actv_payments.participant_invitations,actv_payments.participant_link_audit from public,anon,authenticated,service_role;
create trigger actv_participant_link_audit_immutable before update or delete on actv_payments.participant_link_audit
  for each row execute function actv_payments.guard_registration_audit();

create function actv_payments.participant_linkable(p_registration uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.inscripciones r where r.id=p_registration and r.evento_id is not null and r.folio_asignado is not null
    and r.actv_eligible is distinct from false and (
      (r.actv_order_item_id is null and r.actv_eligible is null and r.monto_pagado::text ~ '^[0-9]+([.][0-9]+)?$')
      or exists(select 1 from actv_payments.items i join actv_payments.orders o on o.id=i.order_id
        join actv_payments.captures c on c.order_id=o.id and c.amount=o.amount and c.currency=o.currency
        where i.id=r.actv_order_item_id and o.state='issued' and r.actv_eligible is true)))
$$;
create function actv_payments.participant_link_buyer(p_actor uuid,p_registration uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id
    join actv_payments.orders o on o.id=i.order_id where r.id=p_registration and o.channel='online'
      and lower(o.buyer_email)=actv_payments.verified_email(p_actor))
$$;
create function actv_payments.can_invite_participant(p_actor uuid,p_registration uuid) returns boolean
language sql stable set search_path='' as $$
  select p_actor is not null and exists(select 1 from public.inscripciones r where r.id=p_registration
    and (actv_payments.can_sell(p_actor,r.evento_id) or actv_payments.participant_link_buyer(p_actor,r.id)))
$$;
create function actv_payments.participant_invitation_json(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',v.id,'registration_id',r.id,'event_id',r.evento_id,'folio',r.folio_asignado,
    'recipient_email',v.recipient_email,'created_at',v.created_at,'expires_at',v.expires_at,
    'verification_method',v.verification_method,
    'state',case when v.redeemed_at is not null then 'linked' when v.revoked_at is not null then 'revoked'
      when v.expires_at<=clock_timestamp() then 'expired' else 'pending' end)
  from actv_payments.participant_invitations v join public.inscripciones r on r.id=v.registration_id where v.id=p_id
$$;

create function public.actv_participant_link_status(p_registration_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.inscripciones; own boolean; can_invite boolean; begin
  select * into r from public.inscripciones where id=p_registration_id;
  own:=exists(select 1 from actv_payments.runner_entries where registration_id=r.id and user_id=auth.uid());
  can_invite:=actv_payments.can_invite_participant(auth.uid(),r.id);
  if r.id is null or (not own and not can_invite) then raise insufficient_privilege; end if;
  return jsonb_build_object('registration_id',r.id,'event_id',r.evento_id,'folio',r.folio_asignado,'personal',own,
    'linked',exists(select 1 from actv_payments.runner_entries where registration_id=r.id),
    'can_invite',can_invite and actv_payments.participant_linkable(r.id)
      and not exists(select 1 from actv_payments.runner_entries where registration_id=r.id),
    'staff_verification',actv_payments.can_sell(auth.uid(),r.evento_id),
    'payment_known',r.actv_eligible is not null,
    'invitation',(select actv_payments.participant_invitation_json(v.id) from actv_payments.participant_invitations v
      where v.registration_id=r.id order by v.created_at desc,v.id desc limit 1));
end $$;

create function public.actv_create_participant_invitation(p_registration_id uuid,p_recipient_email text,
  p_request_id uuid,p_token text,p_reason text,p_verification_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.inscripciones; existing actv_payments.participant_invitations; pending actv_payments.participant_invitations;
  email text:=lower(btrim(p_recipient_email)); digest text; begin
  perform pg_advisory_xact_lock(20261126,12100);
  if actv_payments.verified_email(auth.uid()) is null or not actv_payments.can_invite_participant(auth.uid(),p_registration_id)
    then raise insufficient_privilege; end if;
  if p_request_id is null or p_token is null or p_token !~ '^[a-f0-9]{64}$'
    or email is null or length(email)>250 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_reason is null or length(btrim(p_reason)) not between 10 and 500
    or p_verification_method is null or p_verification_method not in ('buyer_contact','in_person','purchase_contact') then
    raise exception 'Revisa el destinatario y la verificación de identidad' using errcode='22023'; end if;
  select * into strict r from public.inscripciones where id=p_registration_id for update;
  if (p_verification_method='buyer_contact' and not actv_payments.participant_link_buyer(auth.uid(),r.id))
    or (p_verification_method<>'buyer_contact' and not actv_payments.can_sell(auth.uid(),r.evento_id)) then
    raise insufficient_privilege; end if;
  digest:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12900));
  select * into existing from actv_payments.participant_invitations where id=p_request_id;
  if found then
    if (existing.registration_id,existing.created_by,existing.recipient_email,existing.token_digest,existing.reason,existing.verification_method)
      is distinct from (r.id,auth.uid(),email,digest,btrim(p_reason),p_verification_method) then
      raise exception 'La solicitud pertenece a otra invitación' using errcode='23514'; end if;
    return actv_payments.participant_invitation_json(existing.id);
  end if;
  if not actv_payments.participant_linkable(r.id) then raise exception 'La inscripción no admite una nueva vinculación' using errcode='23514'; end if;
  if exists(select 1 from actv_payments.runner_entries where registration_id=r.id) then
    raise exception 'La inscripción ya tiene titular; no se transfiere por invitación' using errcode='23514'; end if;
  select * into pending from actv_payments.participant_invitations
    where registration_id=r.id and revoked_at is null and redeemed_at is null for update;
  if found then
    if pending.expires_at>clock_timestamp() then raise exception 'Revoca la invitación vigente antes de reemplazarla' using errcode='23514'; end if;
    update actv_payments.participant_invitations set revoked_at=clock_timestamp(),revoked_by=auth.uid(),revoked_reason='expired_replacement'
      where id=pending.id;
    insert into actv_payments.participant_link_audit(invitation_id,registration_id,actor,action,reason)
      values(pending.id,r.id,auth.uid(),'expired_replacement',btrim(p_reason));
  end if;
  if not exists(select 1 from actv_payments.events where event_id=r.evento_id) then
    if not actv_payments.is_manager(auth.uid()) then
      raise exception 'Un administrador debe preparar este evento histórico antes de vincular' using errcode='23514'; end if;
    insert into actv_payments.events(event_id,organizer_id,online_enabled)
      values(r.evento_id,'00000000-0000-4000-8000-000000000ac7',false);
    insert into actv_payments.participant_link_audit(registration_id,actor,action,reason)
      values(r.id,auth.uid(),'legacy_event_adopted',btrim(p_reason));
  end if;
  insert into actv_payments.participant_invitations(id,registration_id,recipient_email,token_digest,created_by,verification_method,reason)
    values(p_request_id,r.id,email,digest,auth.uid(),p_verification_method,btrim(p_reason));
  insert into actv_payments.participant_link_audit(invitation_id,registration_id,actor,action,reason,details)
    values(p_request_id,r.id,auth.uid(),'invited',btrim(p_reason),jsonb_build_object('verification_method',p_verification_method,'recipient_email',email));
  return actv_payments.participant_invitation_json(p_request_id);
end $$;

create function public.actv_revoke_participant_invitation(p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation actv_payments.participant_invitations; r_id uuid; begin
  perform pg_advisory_xact_lock(20261126,12100);
  select registration_id into r_id from actv_payments.participant_invitations where id=p_request_id;
  if not actv_payments.can_invite_participant(auth.uid(),r_id) then raise insufficient_privilege; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise invalid_parameter_value; end if;
  perform 1 from public.inscripciones where id=r_id for update;
  select * into strict invitation from actv_payments.participant_invitations where id=p_request_id for update;
  if invitation.redeemed_at is not null then raise exception 'La titularidad ya vinculada requiere otro procedimiento' using errcode='23514'; end if;
  if invitation.revoked_at is null then
    update actv_payments.participant_invitations set revoked_at=clock_timestamp(),revoked_by=auth.uid(),revoked_reason=btrim(p_reason)
      where id=invitation.id;
    insert into actv_payments.participant_link_audit(invitation_id,registration_id,actor,action,reason)
      values(invitation.id,r_id,auth.uid(),'revoked',btrim(p_reason));
  end if;
  return actv_payments.participant_invitation_json(invitation.id);
end $$;

create function actv_payments.accept_participant_invitation(p_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare invitation actv_payments.participant_invitations; r public.inscripciones; r_id uuid; begin
  perform pg_advisory_xact_lock(20261126,12100);
  if actv_payments.verified_email(auth.uid()) is null then raise insufficient_privilege; end if;
  select registration_id into r_id from actv_payments.participant_invitations where id=p_id;
  select * into r from public.inscripciones where id=r_id for update;
  select * into invitation from actv_payments.participant_invitations where id=p_id for update;
  if invitation.id is null or invitation.recipient_email is distinct from actv_payments.verified_email(auth.uid()) then
    raise exception 'Invitación no disponible para esta cuenta' using errcode='P0002'; end if;
  if invitation.redeemed_by=auth.uid() and exists(select 1 from actv_payments.runner_entries
    where registration_id=r.id and user_id=auth.uid()) then
    return jsonb_build_object('registration_id',r.id,'event_id',r.evento_id,'folio',r.folio_asignado,'state','linked');
  end if;
  if invitation.redeemed_at is not null or invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp()
    or not actv_payments.participant_linkable(r.id) then raise exception 'Invitación vencida o inscripción no disponible' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||r.evento_id::text,11602));
  insert into actv_payments.runner_entries(registration_id,event_id,user_id) values(r.id,r.evento_id,auth.uid()) on conflict do nothing;
  if not found then raise exception 'La inscripción o esta edición ya tienen una titularidad conservada' using errcode='23514'; end if;
  update actv_payments.participant_invitations set redeemed_at=clock_timestamp(),redeemed_by=auth.uid() where id=invitation.id;
  insert into actv_payments.participant_link_audit(invitation_id,registration_id,actor,action,reason)
    values(invitation.id,r.id,auth.uid(),'linked','Verified recipient accepted invitation');
  return jsonb_build_object('registration_id',r.id,'event_id',r.evento_id,'folio',r.folio_asignado,'state','linked');
end $$;
create function public.actv_accept_participant_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid; begin
  if actv_payments.verified_email(auth.uid()) is null then raise insufficient_privilege; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invitación no disponible' using errcode='P0002'; end if;
  select id into invitation_id from actv_payments.participant_invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  return actv_payments.accept_participant_invitation(invitation_id);
end $$;
create function public.actv_accept_my_participant_invitation(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  -- Inbox recovery is bound to the same confirmed recipient as the fragment.
  -- It needs no stored raw secret when an email login replaces the URL fragment.
  return actv_payments.accept_participant_invitation(p_request_id);
end $$;

create function public.actv_my_participant_links(p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare email text:=actv_payments.verified_email(auth.uid()); begin
  if email is null then raise insufficient_privilege; end if;
  if p_offset is null or p_offset not between 0 and 1000000 or p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value; end if;
  return jsonb_build_object('total',(select count(*) from public.inscripciones r where
      actv_payments.participant_link_buyer(auth.uid(),r.id) or exists(select 1 from actv_payments.runner_entries where registration_id=r.id and user_id=auth.uid())),
    'registrations',coalesce((select jsonb_agg(value order by event_date desc,id) from (
      select r.id,e.fecha as event_date,jsonb_build_object('registration_id',r.id,'event_id',r.evento_id,'event_name',e.nombre_carrera,
        'folio',r.folio_asignado,'participant_name',concat_ws(' ',s.effective#>>'{participant,nombre}',s.effective#>>'{participant,apellido}'),
        'personal',exists(select 1 from actv_payments.runner_entries where registration_id=r.id and user_id=auth.uid()),
        'can_invite',actv_payments.can_invite_participant(auth.uid(),r.id) and actv_payments.participant_linkable(r.id)
          and not exists(select 1 from actv_payments.runner_entries where registration_id=r.id)) as value
      from public.inscripciones r join public.eventos e on e.id=r.evento_id
      left join actv_payments.registration_snapshots s on s.registration_id=r.id
      where actv_payments.participant_link_buyer(auth.uid(),r.id) or exists(select 1 from actv_payments.runner_entries where registration_id=r.id and user_id=auth.uid())
      order by e.fecha desc,r.id offset p_offset limit p_limit) x),'[]'::jsonb),
    'incoming_total',(select count(*) from actv_payments.participant_invitations v where v.recipient_email=email
      and v.revoked_at is null and v.redeemed_at is null and v.expires_at>clock_timestamp()
      and actv_payments.participant_linkable(v.registration_id)),
    'incoming',coalesce((select jsonb_agg(value order by created_at desc,id) from (
      select v.id,v.created_at,actv_payments.participant_invitation_json(v.id)||jsonb_build_object('event_name',e.nombre_carrera) as value
      from actv_payments.participant_invitations v join public.inscripciones r on r.id=v.registration_id
      join public.eventos e on e.id=r.evento_id where v.recipient_email=email
        and v.revoked_at is null and v.redeemed_at is null and v.expires_at>clock_timestamp()
        and actv_payments.participant_linkable(v.registration_id)
      order by v.created_at desc,v.id desc offset p_offset limit p_limit) x),'[]'::jsonb));
end $$;

-- The previous buyer-only claim cannot bypass explicit participant invitation.
create or replace function public.actv_claim_runner_folio(p_event_id uuid,p_folio text) returns boolean
language plpgsql security definer set search_path='' as $$ begin
  raise exception 'Usa una invitación de participante verificada' using errcode='42501';
end $$;

revoke all on all functions in schema actv_payments from public,anon,authenticated;
revoke all on function public.actv_participant_link_status(uuid),
  public.actv_create_participant_invitation(uuid,text,uuid,text,text,text),public.actv_revoke_participant_invitation(uuid,text),
  public.actv_accept_participant_invitation(text),public.actv_accept_my_participant_invitation(uuid),public.actv_my_participant_links(integer,integer)
  from public,anon,authenticated;
grant execute on function public.actv_participant_link_status(uuid),
  public.actv_create_participant_invitation(uuid,text,uuid,text,text,text),public.actv_revoke_participant_invitation(uuid,text),
  public.actv_accept_participant_invitation(text),public.actv_accept_my_participant_invitation(uuid),public.actv_my_participant_links(integer,integer)
  to authenticated;
notify pgrst,'reload schema';
commit;

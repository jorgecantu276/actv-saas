-- Kit evidence is private operational data. Never DELETE Storage metadata in SQL.
begin;
drop trigger if exists trigger_limpieza_storage on public.inscripciones;
drop function if exists public.borrar_archivo_storage_al_limpiar();
drop function if exists public.limpiar_evidencias_antiguas();
do $$ declare j record; begin
  if to_regclass('cron.job') is not null then
    for j in select jobid from cron.job where jobname='limpieza-diaria-kits' loop
      perform cron.unschedule(j.jobid);
    end loop;
  end if;
end $$;
update storage.buckets set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg'] where id='evidencias_kits';
drop policy if exists "Permitir lectura de evidencias" on storage.objects;
drop policy if exists "Permitir subir evidencias" on storage.objects;

create table actv_payments.kit_evidence (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.inscripciones(id),
  event_id uuid not null references public.eventos(id),
  object_path text not null unique,
  actor_id uuid references auth.users(id),
  requested_at timestamptz,
  committed_at timestamptz,
  state text not null check(state in ('reserved','committed','rejected','deleted')),
  legacy boolean not null default false,
  legacy_reference text,
  legal_hold boolean not null default false,
  deleted_at timestamptz,
  check (legacy or (actor_id is not null and requested_at is not null))
);
create unique index kit_evidence_one_committed on actv_payments.kit_evidence(registration_id) where state='committed';
create table actv_payments.evidence_retention (
  singleton boolean primary key default true check(singleton),
  approved_days integer check(approved_days between 1 and 3650),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  check ((approved_days is null) = (approved_by is null))
);
insert into actv_payments.evidence_retention(singleton) values(true);
create table actv_payments.evidence_cleanup (
  evidence_id uuid primary key references actv_payments.kit_evidence(id),
  state text not null default 'queued' check(state in ('queued','deleting','retry','done')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  leased_until timestamptz,
  last_error text,
  uncertain boolean not null default false,
  completed_at timestamptz
);
alter table actv_payments.kit_evidence enable row level security;
alter table actv_payments.evidence_retention enable row level security;
alter table actv_payments.evidence_cleanup enable row level security;
revoke all on actv_payments.kit_evidence,actv_payments.evidence_retention,actv_payments.evidence_cleanup from public,anon,authenticated;
-- Direct updates bypass request recovery/audit and are no longer supported.
revoke update on public.inscripciones from authenticated;
revoke update(kit_entregado,foto_evidencia) on public.inscripciones from authenticated;

create function public.actv_evidence_adopt_legacy(p_origin text) returns integer
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$
declare n integer; begin
  if not public.actv_is_payment_manager() then raise insufficient_privilege; end if;
  if p_origin !~ '^https://[a-z0-9-]+\.supabase\.co$' and p_origin !~ '^http://(127\.0\.0\.1|localhost):[0-9]+$' then
    raise invalid_parameter_value using message='Explicit Supabase origin required';
  end if;
  insert into actv_payments.kit_evidence(registration_id,event_id,object_path,state,legacy,legacy_reference)
  select i.id,i.evento_id,o.name,'committed',true,i.foto_evidencia from public.inscripciones i
  join storage.objects o on o.bucket_id='evidencias_kits'
    and i.foto_evidencia=p_origin||'/storage/v1/object/public/evidencias_kits/'||o.name
  where not exists(select 1 from actv_payments.kit_evidence e where e.registration_id=i.id or e.object_path=o.name)
  on conflict do nothing;
  get diagnostics n=row_count; return n;
end $$;

create function public.actv_kit_evidence(p_operator uuid,p_registration uuid,p_request uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$
declare r public.inscripciones; e actv_payments.kit_evidence; path text; begin
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
    if coalesce(r.kit_entregado,false) or r.actv_eligible=false or r.monto_pagado::text='WP / Online' then raise check_violation using message='Registration unavailable'; end if;
    path:=r.evento_id::text||'/'||r.id::text||'/'||p_request::text||'.jpg';
    insert into actv_payments.kit_evidence(id,registration_id,event_id,object_path,actor_id,requested_at,state)
    values(p_request,r.id,r.evento_id,path,p_operator,now(),'reserved') returning * into e;
  end if;
  if e.id is null then raise no_data_found; end if;
  if p_action='finalize' and e.state='reserved' then
    if coalesce(r.kit_entregado,false) or r.actv_eligible=false or r.monto_pagado::text='WP / Online' then
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

create function public.actv_evidence_storage_access(p_path text,p_upload boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$ begin
  -- Lock an upload reservation until the Storage transaction completes. Cleanup
  -- takes the conflicting evidence lock before retiring a stale reservation.
  if p_upload then perform 1 from actv_payments.kit_evidence where object_path=p_path for share; end if;
  return exists(select 1 from actv_payments.kit_evidence e where e.object_path=p_path
    and actv_payments.can_sell(auth.uid(),e.event_id)
    and case when p_upload then e.state='reserved' and e.actor_id=auth.uid()
      else e.state='committed' or (e.state='reserved' and e.actor_id=auth.uid()) end);
end
$$;
revoke all on all functions in schema actv_payments from public,anon,authenticated;
revoke all on schema actv_payments from public,anon,authenticated;
grant execute on function public.actv_evidence_storage_access(text,boolean) to authenticated;
create policy actv_evidence_read on storage.objects for select to authenticated
using(bucket_id='evidencias_kits' and public.actv_evidence_storage_access(name,false));
create policy actv_evidence_upload on storage.objects for insert to authenticated
with check(bucket_id='evidencias_kits' and public.actv_evidence_storage_access(name,true)
  and coalesce((metadata->>'size')::bigint,0)<=5242880);
-- A restrictive guard also protects against another broad legacy bucket policy.
create policy actv_evidence_guard on storage.objects as restrictive for all to public
using(bucket_id<>'evidencias_kits' or (auth.role()='authenticated' and public.actv_evidence_storage_access(name,false)))
with check(bucket_id<>'evidencias_kits' or (auth.role()='authenticated' and public.actv_evidence_storage_access(name,true)));
create policy actv_evidence_no_update on storage.objects as restrictive for update to public
using(bucket_id<>'evidencias_kits') with check(bucket_id<>'evidencias_kits');
create policy actv_evidence_no_delete on storage.objects as restrictive for delete to public
using(bucket_id<>'evidencias_kits');

create function public.actv_evidence_policy(p_days integer) returns void
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$ begin
  if not public.actv_is_payment_manager() then raise insufficient_privilege; end if;
  perform 1 from actv_payments.evidence_retention for update;
  if exists(select 1 from actv_payments.evidence_cleanup where state='deleting') then
    raise check_violation using message='Reconcile in-progress deletion before changing policy';
  end if;
  update actv_payments.evidence_retention set approved_days=p_days,
    approved_by=case when p_days is not null then auth.uid() end,
    approved_at=case when p_days is not null then now() end where singleton=true;
end $$;
create function public.actv_evidence_hold(p_evidence uuid,p_hold boolean) returns void
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$ begin
  if not public.actv_is_payment_manager() then raise insufficient_privilege; end if;
  perform 1 from actv_payments.kit_evidence where id=p_evidence for update;
  if not exists(select 1 from actv_payments.kit_evidence where id=p_evidence and state<>'deleted') then
    raise no_data_found using message='Evidence already deleted or unknown';
  end if;
  -- An expired lease still has an uncertain external effect; reconcile before adding a hold.
  if exists(select 1 from actv_payments.evidence_cleanup where evidence_id=p_evidence and state='deleting') then
    raise check_violation using message='Deletion in progress; reconcile before changing hold';
  end if;
  update actv_payments.kit_evidence set legal_hold=p_hold where id=p_evidence;
end $$;
create function public.actv_evidence_cleanup_status() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,actv_payments as $$ begin
  if not public.actv_is_payment_manager() then raise insufficient_privilege; end if;
  return jsonb_build_object('policy',(select to_jsonb(p) from actv_payments.evidence_retention p),
    'queue',coalesce((select jsonb_agg(to_jsonb(q)) from actv_payments.evidence_cleanup q),'[]'::jsonb),
    'unmapped_legacy',(select count(*) from public.inscripciones i where foto_evidencia is not null
      and not exists(select 1 from actv_payments.kit_evidence e where e.registration_id=i.id and e.state='committed')));
end $$;

create function public.actv_evidence_claim_cleanup() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$
declare e actv_payments.kit_evidence; q actv_payments.evidence_cleanup; days integer; begin
  select approved_days into days from actv_payments.evidence_retention for share;
  if days is null then return null; end if;
  -- Only known dates age out. Legacy evidence with unknown dates never expires by guesswork.
  insert into actv_payments.evidence_cleanup(evidence_id)
  select id from actv_payments.kit_evidence where not legal_hold and state in ('committed','reserved','rejected')
    and coalesce(committed_at,requested_at)<now()-make_interval(days=>days)
  on conflict do nothing;
  select k.* into e from actv_payments.kit_evidence k join actv_payments.evidence_cleanup c on c.evidence_id=k.id
    where not k.legal_hold and k.state<>'deleted' and c.state<>'done' and c.available_at<=now()
      and coalesce(k.committed_at,k.requested_at)<now()-make_interval(days=>days)
      and (c.leased_until is null or c.leased_until<now())
    order by c.available_at for update of k skip locked limit 1;
  if e.id is null then return null; end if;
  -- A stale pending upload loses its reservation before any external deletion.
  -- Finalize and Storage INSERT use the same evidence lock/state.
  if e.state='reserved' then update actv_payments.kit_evidence set state='rejected' where id=e.id; end if;
  update actv_payments.evidence_cleanup set state='deleting',lease_id=gen_random_uuid(),leased_until=now()+interval '5 minutes',
    attempts=attempts+1 where evidence_id=e.id returning * into q;
  return jsonb_build_object('id',e.id,'path',e.object_path,'lease',q.lease_id);
end $$;
create function public.actv_evidence_finish_cleanup(p_evidence uuid,p_lease uuid,p_error text) returns void
language plpgsql security definer set search_path=pg_catalog,public,actv_payments as $$
declare e actv_payments.kit_evidence; q actv_payments.evidence_cleanup; begin
  -- Match handover lock order (registration, then evidence) even on response
  -- replay, so reconciliation cannot deadlock with a concurrent status/finalize.
  perform 1 from public.inscripciones where id=(select registration_id from actv_payments.kit_evidence where id=p_evidence) for update;
  select * into e from actv_payments.kit_evidence where id=p_evidence for update;
  select * into q from actv_payments.evidence_cleanup where evidence_id=e.id for update;
  if q.lease_id is distinct from p_lease or q.state<>'deleting' or q.leased_until<now() then raise check_violation using message='Stale cleanup lease'; end if;
  if p_error is not null then
    -- A timeout or API failure can outlive its response. Never release the hold
    -- barrier until a later Storage deletion is positively reconciled. Subsequent
    -- known failures cannot erase an earlier uncertain external effect.
    update actv_payments.evidence_cleanup set
      uncertain=uncertain or p_error like 'storage_delete_%',
      state=case when uncertain or p_error like 'storage_delete_%' then 'deleting' else 'retry' end,
      last_error=left(p_error,160),
      lease_id=case when uncertain or p_error like 'storage_delete_%' then lease_id end,
      leased_until=case when uncertain or p_error like 'storage_delete_%' then leased_until end,
      available_at=now()+make_interval(secs=>least(3600,30*attempts)) where evidence_id=e.id;
    return;
  end if;
  if exists(select 1 from storage.objects where bucket_id='evidencias_kits' and name=e.object_path) then
    raise check_violation using message='Storage API deletion not confirmed';
  end if;
  update public.inscripciones set foto_evidencia=null where id=e.registration_id and
    (foto_evidencia='actv-evidence:'||e.id::text or (e.legacy and foto_evidencia=e.legacy_reference));
  update actv_payments.kit_evidence set state='deleted',deleted_at=now() where id=e.id;
  update actv_payments.evidence_cleanup set state='done',completed_at=now(),last_error=null,lease_id=null,leased_until=null where evidence_id=e.id;
end $$;

revoke all on function public.actv_kit_evidence(uuid,uuid,uuid,text), public.actv_evidence_claim_cleanup(),
 public.actv_evidence_finish_cleanup(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.actv_kit_evidence(uuid,uuid,uuid,text),public.actv_evidence_claim_cleanup(),
 public.actv_evidence_finish_cleanup(uuid,uuid,text) to service_role;
revoke all on function public.actv_evidence_adopt_legacy(text),public.actv_evidence_policy(integer),
 public.actv_evidence_hold(uuid,boolean),public.actv_evidence_cleanup_status() from public,anon;
grant execute on function public.actv_evidence_adopt_legacy(text),public.actv_evidence_policy(integer),
 public.actv_evidence_hold(uuid,boolean),public.actv_evidence_cleanup_status() to authenticated;
revoke all on function public.actv_evidence_storage_access(text,boolean) from public,anon;
notify pgrst,'reload schema';
commit;

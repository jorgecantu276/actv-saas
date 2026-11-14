begin;

-- The old browser app used open tables. Payment records, prices and staff
-- permissions require trusted writers. Pilot staff are provisioned explicitly.
create function public.actv_is_payment_manager()
returns boolean language sql stable security definer set search_path='' as $$
  select actv_payments.is_manager(auth.uid())
$$;
create function public.actv_is_payment_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select actv_payments.role(auth.uid()) is not null
$$;
create function public.actv_can_work_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select actv_payments.can_sell(auth.uid(),p_event_id)
$$;

revoke all on function public.actv_is_payment_manager(),public.actv_is_payment_staff(),
  public.actv_can_work_event(uuid) from public,anon,authenticated;
grant execute on function public.actv_is_payment_manager(),public.actv_is_payment_staff(),
  public.actv_can_work_event(uuid) to authenticated;

alter table public.perfiles enable row level security;
alter table public.atletas enable row level security;
alter table public.eventos enable row level security;
alter table public.inscripciones enable row level security;
revoke all on public.perfiles,public.eventos,public.inscripciones,public.atletas from public,anon;
revoke update on public.inscripciones from authenticated;
grant update (kit_entregado,foto_evidencia) on public.inscripciones to authenticated;
grant select,insert,update,delete on public.perfiles,public.eventos,public.atletas to authenticated;
grant select on public.inscripciones to authenticated;

create policy actv_profile_read on public.perfiles for select to authenticated
  using (id=(select auth.uid()) or (select public.actv_is_payment_staff()));
create policy actv_profile_admin on public.perfiles for all to authenticated
  using ((select public.actv_is_payment_manager())) with check ((select public.actv_is_payment_manager()));
create policy actv_athletes_staff on public.atletas for all to authenticated
  using ((select public.actv_is_payment_staff())) with check ((select public.actv_is_payment_staff()));
create policy actv_event_read on public.eventos for select to authenticated
  using (public.actv_can_work_event(id));
create policy actv_event_admin on public.eventos for all to authenticated
  using ((select public.actv_is_payment_manager())) with check ((select public.actv_is_payment_manager()));
create policy actv_registrations_read on public.inscripciones for select to authenticated
  using (public.actv_can_work_event(evento_id));
create policy actv_registrations_kit on public.inscripciones for update to authenticated
  using (public.actv_can_work_event(evento_id)) with check (public.actv_can_work_event(evento_id));
commit;

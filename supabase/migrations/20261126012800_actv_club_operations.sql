begin;

-- Clubs remain a global staff directory, distinct from an organizer's event
-- roster and from immutable registration-specific club snapshots.
create table actv_payments.club_changes (
  id bigint generated always as identity primary key,
  club_id bigint not null, actor uuid references auth.users(id),
  happened_at timestamptz not null default now(),
  action text not null check(action in ('INSERT','UPDATE','DELETE')),
  before_state jsonb, after_state jsonb
);
alter table actv_payments.club_changes enable row level security;
revoke all on actv_payments.club_changes from public,anon,authenticated,service_role;
create function actv_payments.audit_club_change() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into actv_payments.club_changes(club_id,actor,action,before_state,after_state)
    values(case when tg_op='DELETE' then old.id else new.id end,auth.uid(),tg_op,
      case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  if tg_op='DELETE' then return old; end if; return new;
end $$;
do $$ begin
  -- The bounded financial fixture deliberately omits directory tables. The full
  -- operational baseline exercises this trigger against the actual table.
  if to_regclass('public.clubes') is not null then
    execute 'create trigger actv_club_change after insert or update or delete on public.clubes for each row execute function actv_payments.audit_club_change()';
  end if;
end $$;
create trigger actv_club_changes_immutable before update or delete on actv_payments.club_changes
for each row execute function actv_payments.guard_registration_audit();

create function public.actv_operations_clubs(p_query text default '',p_offset integer default 0,p_limit integer default 25,p_sort text default 'az')
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if actv_payments.role(auth.uid()) is null then raise insufficient_privilege; end if;
  if p_query is null or length(p_query)>120 or p_offset is null or p_offset not between 0 and 1000000
    or p_limit is null or p_limit not between 1 and 100 or p_sort is null or p_sort not in ('az','za','mayor','menor') then
    raise exception 'Página de clubes inválida' using errcode='22023'; end if;
  return (
    with matches as (
      select c.*,(select count(*) from public.atletas a where a.club=c.nombre) as total_atletas
      from public.clubes c where position(lower(p_query) in lower(concat_ws(' ',c.nombre,c.responsable1,c.responsable2)))>0
    ), numbered as (
      select m.*,row_number() over(order by
        case when p_sort='az' then lower(btrim(nombre)) end asc,
        case when p_sort='za' then lower(btrim(nombre)) end desc,
        case when p_sort='mayor' then total_atletas end desc,
        case when p_sort='menor' then total_atletas end asc,
        lower(btrim(nombre)),id) as position from matches m
    ) select jsonb_build_object('total',(select count(*) from matches),
      'rows',coalesce((select jsonb_agg(to_jsonb(x)-'position' order by position) from (
        select * from numbered order by position offset p_offset limit p_limit) x),'[]'::jsonb))
  );
end $$;

create function public.actv_operations_club_members(p_club_id bigint,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare club_name text; begin
  if actv_payments.role(auth.uid()) is null then raise insufficient_privilege; end if;
  if p_club_id is null or p_query is null or length(p_query)>120 or p_offset is null or p_offset not between 0 and 1000000
    or p_limit is null or p_limit not between 1 and 100 then raise exception 'Página de integrantes inválida' using errcode='22023'; end if;
  select nombre into club_name from public.clubes where id=p_club_id;
  if not found then raise exception 'Club no disponible' using errcode='P0002'; end if;
  return (with matches as (
    select a.id,a.nombre,a.apellido,a.telefono,a.club,a.talla_playera,a.genero
    from public.atletas a where a.club=club_name
      and position(lower(p_query) in lower(concat_ws(' ',a.nombre,a.apellido,a.telefono)))>0
  ) select jsonb_build_object('club',jsonb_build_object('id',p_club_id,'nombre',club_name),'total',(select count(*) from matches),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.nombre),lower(x.apellido),x.id) from (
      select * from matches order by lower(nombre),lower(apellido),id offset p_offset limit p_limit) x),'[]'::jsonb)));
end $$;

create function public.actv_save_club(p_club_id bigint,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k text; v text; saved jsonb; begin
  perform pg_advisory_xact_lock(20261126,12100);
  if actv_payments.role(auth.uid()) is null then raise insufficient_privilege; end if;
  if jsonb_typeof(p_fields) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_fields) field
    where field<>all(array['nombre','responsable1','telefono1','responsable2','telefono2','logo_url','facebook_url','instagram_url','web_url'])) then
    raise exception 'Datos de club inválidos' using errcode='22023'; end if;
  foreach k in array array['nombre','responsable1','telefono1','responsable2','telefono2','logo_url','facebook_url','instagram_url','web_url'] loop
    v:=nullif(btrim(p_fields->>k),'');
    if (p_fields ? k and jsonb_typeof(p_fields->k) not in ('string','null'))
      or (k in ('nombre','responsable1','telefono1') and v is null)
      or length(v)>(case when k like '%_url' then 2048 when k like 'telefono%' then 30 else 150 end)
      or (k like '%_url' and v is not null and v !~ '^https?://[^[:space:]]+$') then
      raise exception 'Revisa el campo % del club',k using errcode='22023'; end if;
  end loop;
  if p_club_id is null then
    insert into public.clubes(nombre,responsable1,telefono1,responsable2,telefono2,logo_url,facebook_url,instagram_url,web_url)
    values(btrim(p_fields->>'nombre'),btrim(p_fields->>'responsable1'),btrim(p_fields->>'telefono1'),
      nullif(btrim(p_fields->>'responsable2'),''),nullif(btrim(p_fields->>'telefono2'),''),nullif(btrim(p_fields->>'logo_url'),''),
      nullif(btrim(p_fields->>'facebook_url'),''),nullif(btrim(p_fields->>'instagram_url'),''),nullif(btrim(p_fields->>'web_url'),''))
    returning to_jsonb(clubes.*) into saved;
  else
    -- Directory renaming preserves the original behavior: it does not rewrite
    -- athlete profile strings, registration snapshots, claims or financial rows.
    update public.clubes set nombre=btrim(p_fields->>'nombre'),responsable1=btrim(p_fields->>'responsable1'),telefono1=btrim(p_fields->>'telefono1'),
      responsable2=nullif(btrim(p_fields->>'responsable2'),''),telefono2=nullif(btrim(p_fields->>'telefono2'),''),logo_url=nullif(btrim(p_fields->>'logo_url'),''),
      facebook_url=nullif(btrim(p_fields->>'facebook_url'),''),instagram_url=nullif(btrim(p_fields->>'instagram_url'),''),web_url=nullif(btrim(p_fields->>'web_url'),'')
    where id=p_club_id returning to_jsonb(clubes.*) into saved;
    if not found then raise exception 'Club no disponible' using errcode='P0002'; end if;
  end if;
  return saved;
end $$;

create function public.actv_delete_club(p_club_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$ begin
  perform pg_advisory_xact_lock(20261126,12100);
  if actv_payments.role(auth.uid()) is null then raise insufficient_privilege; end if;
  delete from public.clubes where id=p_club_id;
  if not found then raise exception 'Club no disponible' using errcode='P0002'; end if;
  return true;
end $$;

revoke all on function actv_payments.audit_club_change(),public.actv_operations_clubs(text,integer,integer,text),
  public.actv_operations_club_members(bigint,text,integer,integer),public.actv_save_club(bigint,jsonb),public.actv_delete_club(bigint)
  from public,anon,authenticated;
grant execute on function public.actv_operations_clubs(text,integer,integer,text),public.actv_operations_club_members(bigint,text,integer,integer),
  public.actv_save_club(bigint,jsonb),public.actv_delete_club(bigint) to authenticated;
notify pgrst,'reload schema';
commit;

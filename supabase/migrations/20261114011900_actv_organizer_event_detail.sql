begin;

create function public.actv_organizer_event_detail(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  context jsonb;
begin
  context := public.actv_organizer(auth.uid(),p_event_id);
  return context || (
    select jsonb_build_object('date',e.fecha,'distance',e.distancia,'capacity',e.cupo_maximo)
    from public.eventos e where e.id=p_event_id
  );
end $$;

create function public.actv_create_organizer_event(
  p_name text,p_date date,p_slug text,p_price integer,p_capacity integer,p_distance text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  created jsonb;
  distance text := nullif(btrim(p_distance),'');
begin
  if length(distance) > 45 then
    raise exception 'La distancia admite hasta 45 caracteres' using errcode='22023';
  end if;
  created := public.actv_create_organizer_event(p_name,p_date,p_slug,p_price,p_capacity);
  if distance is not null then
    update public.eventos e
      set distancia=distance
      where e.id=(created->>'event_id')::uuid and e.distancia in ('Por confirmar',distance);
    if not found then
      raise exception 'La dirección ya está asociada a una carrera' using errcode='23505';
    end if;
  end if;
  return created;
end $$;

revoke all on function public.actv_organizer_event_detail(uuid),
  public.actv_create_organizer_event(text,date,text,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.actv_organizer_event_detail(uuid),
  public.actv_create_organizer_event(text,date,text,integer,integer,text)
  to authenticated;

commit;

begin;

create function public.actv_read_order(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select actv_payments.order_json(p_order_id)
$$;

create function public.actv_attach_provider(p_order_id uuid,p_account_id text,p_live_mode boolean,
  p_session_id text default null,p_payment_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order actv_payments.orders;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if v_order.channel='cash' or v_order.account_id is distinct from p_account_id
    or v_order.live_mode is distinct from p_live_mode
    or (p_session_id is not null and (v_order.channel<>'online' or p_session_id !~ '^cs_[A-Za-z0-9_]+$'))
    or (p_payment_id is not null and p_payment_id !~ '^pi_[A-Za-z0-9_]+$')
    or (p_session_id is not null and v_order.provider_session_id is not null and p_session_id<>v_order.provider_session_id)
    or (p_payment_id is not null and v_order.provider_payment_id is not null and p_payment_id<>v_order.provider_payment_id) then
    raise exception 'Referencia de Stripe incompatible';
  end if;
  if v_order.channel='terminal' and v_order.state<>'pending'
    and v_order.provider_payment_id is distinct from p_payment_id then
    raise exception 'El pedido de terminal está cerrado';
  end if;
  if v_order.state='pending' or v_order.provider_session_id is null or v_order.provider_payment_id is null then
    update actv_payments.orders set provider_session_id=coalesce(provider_session_id,p_session_id),
      provider_payment_id=coalesce(provider_payment_id,p_payment_id) where id=p_order_id;
  end if;
  return actv_payments.order_json(p_order_id);
end $$;

create function public.actv_confirm_stripe(
  p_order_id uuid,p_account_id text,p_live_mode boolean,p_payment_id text,p_amount bigint,p_currency text,
  p_session_id text default null,p_charge_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order actv_payments.orders;
  v_capture actv_payments.captures;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if p_amount is distinct from v_order.amount or lower(p_currency) is distinct from v_order.currency
    or p_payment_id is null or p_charge_id is null or p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
    or (v_order.channel='online' and
      (p_session_id is null or v_order.provider_session_id is distinct from p_session_id))
    or (v_order.channel='terminal' and v_order.provider_payment_id is distinct from p_payment_id) then
    raise exception 'El cargo no coincide con el pedido';
  end if;
  perform public.actv_attach_provider(p_order_id,p_account_id,p_live_mode,p_session_id,p_payment_id);
  insert into actv_payments.captures(order_id,account_id,live_mode,provider_payment_id,charge_id,amount,currency)
    values(p_order_id,p_account_id,p_live_mode,p_payment_id,p_charge_id,p_amount,lower(p_currency))
    on conflict(order_id) do nothing;
  select * into strict v_capture from actv_payments.captures where order_id=p_order_id;
  if v_capture.charge_id is distinct from p_charge_id then raise exception 'Cargo duplicado o incompatible'; end if;
  return actv_payments.issue(p_order_id);
end $$;

create function public.actv_mark_closed(
  p_order_id uuid,p_account_id text,p_live_mode boolean,p_session_id text default null,p_payment_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order actv_payments.orders;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if (v_order.channel='online' and p_session_id is null) or (v_order.channel='terminal' and p_payment_id is null) then
    raise exception 'Referencia de cierre requerida';
  end if;
  perform public.actv_attach_provider(p_order_id,p_account_id,p_live_mode,p_session_id,p_payment_id);
  update actv_payments.orders set state='closed' where id=p_order_id and state='pending'
    and not exists(select 1 from actv_payments.captures where order_id=p_order_id);
  return actv_payments.order_json(p_order_id);
end $$;

create function public.actv_record_stripe_event(
  p_account_id text,p_live_mode boolean,p_event_id text,p_type text,p_object_id text,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from actv_payments.accounts where account_id=p_account_id and live_mode=p_live_mode)
  then return jsonb_build_object('known_account',false,'processed',true); end if;
  insert into actv_payments.provider_events(account_id,live_mode,event_id,type,object_id,order_id)
  values(p_account_id,p_live_mode,p_event_id,p_type,p_object_id,p_order_id) on conflict do nothing;
  return (select jsonb_build_object('known_account',true,'processed',processed_at is not null)
    from actv_payments.provider_events where account_id=p_account_id and live_mode=p_live_mode and event_id=p_event_id);
end $$;

create function public.actv_finish_stripe_event(p_account_id text,p_live_mode boolean,p_event_id text)
returns void language sql security definer set search_path='' as $$
  update actv_payments.provider_events set processed_at=coalesce(processed_at,now())
  where account_id=p_account_id and live_mode=p_live_mode and event_id=p_event_id
$$;

create function public.actv_checked_stripe_event(p_account_id text,p_live_mode boolean,p_event_id text,p_failure_code text default null)
returns void language sql security definer set search_path='' as $$
  update actv_payments.provider_events set attempts=attempts+1,
    retry_after=now()+make_interval(secs=>least(3600,15*(1<<least(attempts,8)))),
    failure_code=left(p_failure_code,80)
  where account_id=p_account_id and live_mode=p_live_mode and event_id=p_event_id and processed_at is null
$$;

create function public.actv_pending_stripe(p_live_mode boolean,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('events',coalesce((
    select jsonb_agg(to_jsonb(e)||jsonb_build_object('event_type',e.type) order by e.received_at)
    from (select * from actv_payments.provider_events
          where live_mode=p_live_mode and processed_at is null and retry_after<=now()
          order by retry_after,received_at,event_id limit least(greatest(p_limit,1),100)) e
  ),'[]'::jsonb),'orders',coalesce((
    select jsonb_agg(jsonb_build_object('order_id',o.id,'channel',o.channel,'state',o.state,'account_id',o.account_id,
      'live_mode',o.live_mode,'provider_session_id',o.provider_session_id,
      'provider_payment_id',o.provider_payment_id,'expires_at',o.expires_at) order by o.checked_at nulls first)
    from (select * from actv_payments.orders
          where live_mode=p_live_mode and state='pending'
            and coalesce(provider_session_id,provider_payment_id) is not null
            and (checked_at is null or checked_at<now()-interval '30 seconds')
          order by checked_at nulls first,created_at,id limit least(greatest(p_limit,1),100)) o
  ),'[]'::jsonb))
$$;

create function public.actv_checked_order(p_order_id uuid)
returns void language sql security definer set search_path='' as $$
  update actv_payments.orders set checked_at=now() where id=p_order_id and state='pending'
$$;

create function public.actv_close_unbound_terminals(p_live_mode boolean)
returns void language sql security definer set search_path='' as $$
  update actv_payments.orders set state='closed'
    where channel='terminal' and state='pending' and expires_at<=now()
      and live_mode=p_live_mode and provider_payment_id is null
$$;

create function public.actv_record_adjustment(
  p_account_id text,p_live_mode boolean,p_reference text,p_kind text,p_payment_id text,p_amount bigint,p_currency text,p_state text)
returns void language plpgsql security definer set search_path='' as $$
declare v_order uuid;
begin
  if not exists(select 1 from actv_payments.accounts where account_id=p_account_id and live_mode=p_live_mode)
    or p_payment_id is null then return; end if;
  select id into v_order from actv_payments.orders
    where account_id=p_account_id and live_mode=p_live_mode and provider_payment_id=p_payment_id for update;
  insert into actv_payments.adjustments(account_id,live_mode,reference,kind,payment_id,amount,currency,state)
  values(p_account_id,p_live_mode,p_reference,p_kind,p_payment_id,p_amount,lower(p_currency),p_state)
  on conflict(account_id,live_mode,reference) do update set state=excluded.state
    where (adjustments.kind,adjustments.payment_id,adjustments.amount,adjustments.currency)=
          (excluded.kind,excluded.payment_id,excluded.amount,excluded.currency)
      and (adjustments.state=excluded.state or adjustments.state not in ('succeeded','failed','canceled','won','lost'));
  if v_order is not null then perform actv_payments.refresh_eligibility(v_order); end if;
end $$;

create function public.actv_record_settlement(
  p_account_id text,p_live_mode boolean,p_payout_id text,p_amount bigint,p_currency text,p_state text,p_lines jsonb default '[]')
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from actv_payments.accounts where account_id=p_account_id and live_mode=p_live_mode)
  then return; end if;
  insert into actv_payments.settlements(account_id,live_mode,payout_id,amount,currency,state)
  values(p_account_id,p_live_mode,p_payout_id,p_amount,lower(p_currency),p_state)
  on conflict(account_id,live_mode,payout_id) do update set state=excluded.state;
  insert into actv_payments.settlement_lines(account_id,live_mode,payout_id,id,source,amount,fee,net,currency)
    select p_account_id,p_live_mode,p_payout_id,l.id,l.source,l.amount,l.fee,l.net,lower(l.currency)
    from jsonb_to_recordset(p_lines) l(id text,source text,amount bigint,fee bigint,net bigint,currency text)
  on conflict(account_id,live_mode,id) do update set payout_id=excluded.payout_id,source=excluded.source,
    amount=excluded.amount,fee=excluded.fee,net=excluded.net,currency=excluded.currency;
end $$;

create function public.actv_organizer(p_operator uuid,p_event_id uuid,p_live_mode boolean default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from actv_payments.events e where e.event_id=p_event_id
    and actv_payments.can_manage(p_operator,e.organizer_id)) then
    raise exception 'Organizador no asignado al evento' using errcode='42501';
  end if;
  return (select jsonb_build_object('organizer_id',e.organizer_id,'account_id',a.account_id,
    'live_mode',coalesce(p_live_mode,e.live_mode),'ready',coalesce(a.ready,false),
    'online_enabled',e.online_enabled and coalesce(p_live_mode,e.live_mode)=e.live_mode,
    'terminal_reader_id',e.reader_id,'event_id',e.event_id,'slug',coalesce(e.slug,e.event_id::text),'event_name',v.nombre_carrera)
    from actv_payments.events e join public.eventos v on v.id=e.event_id
    left join actv_payments.accounts a on a.organizer_id=e.organizer_id and a.live_mode=coalesce(p_live_mode,e.live_mode)
    where e.event_id=p_event_id);
end $$;

create function public.actv_set_account(
  p_operator uuid,p_event_id uuid,p_account_id text,p_live_mode boolean,p_ready boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_organizer uuid;
begin
  perform public.actv_organizer(p_operator,p_event_id);
  select organizer_id into strict v_organizer from actv_payments.events where event_id=p_event_id for update;
  insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready)
    values(v_organizer,p_live_mode,p_account_id,p_ready)
  on conflict(organizer_id,live_mode) do update set ready=excluded.ready
    where accounts.account_id=excluded.account_id;
  if not found then raise exception 'La cuenta del organizador ya está asignada'; end if;
  update actv_payments.events set live_mode=p_live_mode,online_enabled=false,reader_id=null
    where event_id=p_event_id and live_mode<>p_live_mode;
  return public.actv_organizer(p_operator,p_event_id);
end $$;

create function public.actv_refresh_account(p_account_id text,p_live_mode boolean,p_ready boolean)
returns void language sql security definer set search_path='' as $$
  update actv_payments.accounts set ready=p_ready where account_id=p_account_id and live_mode=p_live_mode
$$;

create function public.actv_configure_event(p_event_id uuid,p_online_enabled boolean,
  p_reader_id text default null,p_slug text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb;
begin
  v_context:=public.actv_organizer(auth.uid(),p_event_id);
  if p_online_enabled and (v_context->>'ready')::boolean is not true
    then raise exception 'Completa la activación de Stripe'; end if;
  if p_reader_id is not null and not actv_payments.is_manager(auth.uid())
    then raise exception 'Solo administración puede ajustar una terminal' using errcode='42501'; end if;
  update actv_payments.events set online_enabled=p_online_enabled,reader_id=coalesce(p_reader_id,reader_id),
    slug=coalesce(p_slug,slug) where event_id=p_event_id;
  return public.actv_organizer(auth.uid(),p_event_id);
end $$;

create function public.actv_catalog(p_event_id uuid default null,p_slug text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',e.id,'event_id',e.id,'slug',coalesce(c.slug,e.id::text),
    'name',e.nombre_carrera,'date',e.fecha,'description',e.descripcion,'currency','mxn',
    'available',greatest(0,e.cupo_maximo-actv_payments.used(e.id)),'options',p.options,'packages',p.options)
  from public.eventos e join actv_payments.events c on e.id=c.event_id
  join actv_payments.accounts a on a.organizer_id=c.organizer_id and a.live_mode=c.live_mode
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id',n,'package',n,'name',label,'amount',(price*100)::bigint,
      'amountMinor',(price*100)::bigint,'currency','mxn') order by n) as options
    from (values (1,e.nombre_precio_1,e.precio_1),(2,e.nombre_precio_2,e.precio_2)) x(n,label,price)
    where label is not null and price between 10 and 999999.99 and price*100=trunc(price*100)
  ) p
  where ((p_event_id is not null and e.id=p_event_id)
    or (p_event_id is null and (c.slug=p_slug or e.id::text=p_slug)))
    and e.activo and e.fecha >= (now() at time zone 'America/Matamoros')::date
    and c.online_enabled and a.ready and p.options is not null
  order by (c.slug=p_slug) desc nulls last limit 1
$$;

revoke all on function
  public.actv_read_order(uuid),public.actv_attach_provider(uuid,text,boolean,text,text),
  public.actv_confirm_stripe(uuid,text,boolean,text,bigint,text,text,text),
  public.actv_mark_closed(uuid,text,boolean,text,text),
  public.actv_record_stripe_event(text,boolean,text,text,text,uuid),
  public.actv_finish_stripe_event(text,boolean,text),public.actv_checked_stripe_event(text,boolean,text,text),
  public.actv_pending_stripe(boolean,integer),
  public.actv_checked_order(uuid),public.actv_close_unbound_terminals(boolean),
  public.actv_record_adjustment(text,boolean,text,text,text,bigint,text,text),
  public.actv_record_settlement(text,boolean,text,bigint,text,text,jsonb),
  public.actv_organizer(uuid,uuid,boolean),public.actv_set_account(uuid,uuid,text,boolean,boolean),
  public.actv_refresh_account(text,boolean,boolean),public.actv_catalog(uuid,text),
  public.actv_configure_event(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function
  public.actv_read_order(uuid),public.actv_attach_provider(uuid,text,boolean,text,text),
  public.actv_confirm_stripe(uuid,text,boolean,text,bigint,text,text,text),
  public.actv_mark_closed(uuid,text,boolean,text,text),
  public.actv_record_stripe_event(text,boolean,text,text,text,uuid),
  public.actv_finish_stripe_event(text,boolean,text),public.actv_checked_stripe_event(text,boolean,text,text),
  public.actv_pending_stripe(boolean,integer),
  public.actv_checked_order(uuid),public.actv_close_unbound_terminals(boolean),
  public.actv_record_adjustment(text,boolean,text,text,text,bigint,text,text),
  public.actv_record_settlement(text,boolean,text,bigint,text,text,jsonb),
  public.actv_organizer(uuid,uuid,boolean),public.actv_set_account(uuid,uuid,text,boolean,boolean),
  public.actv_refresh_account(text,boolean,boolean),public.actv_catalog(uuid,text) to service_role;
grant execute on function public.actv_configure_event(uuid,boolean,text,text) to authenticated;
commit;

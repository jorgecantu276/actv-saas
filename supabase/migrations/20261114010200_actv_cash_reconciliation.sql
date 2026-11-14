begin;

create function actv_payments.shift_json(p_shift uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',s.id,'opened_at',s.opened_at,'closed_at',s.closed_at,'opening',s.opening,
    'expected',coalesce(s.expected,s.opening+(select coalesce(sum(amount),0) from actv_payments.captures where shift_id=s.id)),
    'counted',s.counted,'variance',s.counted-s.expected,'state',case when s.closed_at is null then 'open' else 'closed' end,
    'deposit_amount',s.deposit_amount,'deposit_reference',s.deposit_reference,'deposit_expected',s.counted-s.opening,
    'deposit_variance',s.deposit_amount-(s.counted-s.opening))
  from actv_payments.shifts s where id=p_shift
$$;

create function public.actv_create_staff_order(p_event_id uuid,p_request_id uuid,p_channel text,p_items jsonb,p_relay boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_channel not in ('cash','terminal') or auth.uid() is null then
    raise exception 'Canal de caja inválido' using errcode='42501';
  end if;
  return public.actv_create_order(p_event_id,p_request_id,p_channel,p_items,auth.uid(),p_relay);
end $$;

create function public.actv_staff_order_status(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.actv_order_status(p_order_id,null,auth.uid())
$$;

create function public.actv_cash_shift() returns jsonb
language sql stable security definer set search_path='' as $$
  select actv_payments.shift_json(id) from actv_payments.shifts where operator=auth.uid() and closed_at is null
$$;

create function public.actv_open_shift(p_opening bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_shift uuid;
begin
  if actv_payments.role(auth.uid()) is null
    then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_opening is null or p_opening not between 0 and 100000000 then raise exception 'Fondo inválido'; end if;
  insert into actv_payments.shifts(operator,opening) values(auth.uid(),p_opening)
  on conflict (operator) where closed_at is null do nothing returning id into v_shift;
  return coalesce(actv_payments.shift_json(v_shift),public.actv_cash_shift());
end $$;

create function public.actv_confirm_cash(p_order_id uuid,p_shift_id uuid,p_received bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order actv_payments.orders;
  v_shift actv_payments.shifts;
  v_capture actv_payments.captures;
begin
  select * into strict v_order from actv_payments.orders where id=p_order_id for update;
  if v_order.channel<>'cash' or auth.uid() is null or v_order.operator<>auth.uid()
     or not actv_payments.can_sell(auth.uid(),v_order.event_id)
    then raise exception 'No autorizado' using errcode='42501'; end if;
  select * into v_capture from actv_payments.captures where order_id=p_order_id;
  if found then
    if v_capture.shift_id is distinct from p_shift_id or v_capture.tendered is distinct from p_received
      then raise exception 'El pago ya está registrado con otros datos'; end if;
    return actv_payments.order_json(p_order_id);
  end if;
  if v_order.state<>'pending' or v_order.expires_at<=now() then raise exception 'Pedido vencido o cerrado'; end if;
  select * into strict v_shift from actv_payments.shifts where id=p_shift_id for update;
  if v_shift.operator<>auth.uid() or v_shift.closed_at is not null then raise exception 'Caja no abierta'; end if;
  if p_received is null or p_received<v_order.amount or p_received>100000000 then raise exception 'Efectivo insuficiente o inválido'; end if;
  insert into actv_payments.captures(order_id,live_mode,shift_id,tendered,amount,currency)
    values(p_order_id,v_order.live_mode,p_shift_id,p_received,v_order.amount,v_order.currency);
  return actv_payments.issue(p_order_id);
end $$;

create function public.actv_cancel_cash(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  update actv_payments.orders set state='closed'
    where id=p_order_id and channel='cash' and operator=auth.uid() and state='pending'
      and not exists(select 1 from actv_payments.captures where order_id=p_order_id);
  return public.actv_staff_order_status(p_order_id);
end $$;

create function public.actv_close_shift(p_shift_id uuid,p_counted bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_shift actv_payments.shifts;
begin
  select * into strict v_shift from actv_payments.shifts where id=p_shift_id for update;
  if auth.uid() is null or v_shift.operator<>auth.uid() then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_counted is null or p_counted not between 0 and 100000000 then raise exception 'Conteo inválido'; end if;
  if v_shift.closed_at is not null and v_shift.counted<>p_counted then raise exception 'El corte ya quedó registrado'; end if;
  if v_shift.closed_at is null then
    update actv_payments.shifts set closed_at=now(),counted=p_counted,
      expected=opening+(select coalesce(sum(amount),0) from actv_payments.captures where shift_id=p_shift_id)
    where id=p_shift_id;
  end if;
  return actv_payments.shift_json(p_shift_id);
end $$;

create function public.actv_match_cash_deposit(p_shift_id uuid,p_reference text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not actv_payments.is_manager(auth.uid()) then raise exception 'No autorizado' using errcode='42501'; end if;
  if length(trim(coalesce(p_reference,''))) not between 1 and 200 or p_amount is null or p_amount<0
    then raise exception 'Depósito inválido'; end if;
  update actv_payments.shifts set deposit_reference=trim(p_reference),deposit_amount=p_amount,
    deposited_by=coalesce(deposited_by,auth.uid()),deposited_at=coalesce(deposited_at,now())
  where id=p_shift_id and closed_at is not null and ((deposit_reference is null) or
    (deposit_reference=trim(p_reference) and deposit_amount=p_amount));
  if not found then raise exception 'Corte pendiente o depósito ya registrado'; end if;
  return actv_payments.shift_json(p_shift_id);
end $$;

create function public.actv_match_bank(p_account_id text,p_live_mode boolean,p_payout_id text,p_reference text,p_amount bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not actv_payments.is_manager(auth.uid()) then raise exception 'No autorizado' using errcode='42501'; end if;
  if length(trim(coalesce(p_reference,''))) not between 1 and 200 or p_amount is null or p_amount<0
    then raise exception 'Depósito inválido'; end if;
  update actv_payments.settlements set bank_reference=trim(p_reference),bank_amount=p_amount,
    bank_matched_by=coalesce(bank_matched_by,auth.uid()),bank_matched_at=coalesce(bank_matched_at,now())
  where account_id=p_account_id and live_mode=p_live_mode and payout_id=p_payout_id and state='paid'
    and (bank_reference is null or (bank_reference=trim(p_reference) and bank_amount=p_amount));
  if not found then raise exception 'Liquidación no pagada o depósito ya registrado'; end if;
end $$;

create function public.actv_reconciliation(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_from timestamptz:=p_from::timestamp at time zone 'America/Matamoros';
  v_until timestamptz:=(p_to+1)::timestamp at time zone 'America/Matamoros';
begin
  if not actv_payments.is_manager(auth.uid()) then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'Rango inválido'; end if;
  return jsonb_build_object(
    'channels',coalesce((
      with captures as (
        select o.channel,o.live_mode,count(*) as orders,sum(c.amount) as captured
        from actv_payments.captures c join actv_payments.orders o on o.id=c.order_id
        where c.captured_at>=v_from and c.captured_at<v_until group by 1,2
      ), adjustments as (
        select o.channel,o.live_mode,sum(a.amount) as total
        from actv_payments.adjustments a join actv_payments.orders o on
          (o.account_id,o.live_mode,o.provider_payment_id)=(a.account_id,a.live_mode,a.payment_id)
        where a.recorded_at>=v_from and a.recorded_at<v_until
          and ((a.kind='refund' and a.state='succeeded') or (a.kind='dispute' and a.state='lost'))
        group by 1,2
      )
      select jsonb_agg(jsonb_build_object('channel',coalesce(c.channel,a.channel),'live_mode',coalesce(c.live_mode,a.live_mode),
        'orders',coalesce(c.orders,0),'captured',coalesce(c.captured,0),'adjustments',coalesce(a.total,0),
        'net',coalesce(c.captured,0)-coalesce(a.total,0)))
      from captures c full join adjustments a using(channel,live_mode)
    ),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(actv_payments.shift_json(id) order by opened_at desc)
      from actv_payments.shifts where opened_at<v_until and (closed_at is null or closed_at>=v_from)),'[]'::jsonb),
    'settlements',coalesce((select jsonb_agg(jsonb_build_object(
      'account_id',s.account_id,'live_mode',s.live_mode,'payout_id',s.payout_id,'state',s.state,
      'amount',s.amount,'currency',s.currency,'lines_total',l.total,'variance',l.total-s.amount,
      'unmatched_charge_lines',l.unmatched,'bank_reference',s.bank_reference,'bank_amount',s.bank_amount,
      'bank_variance',s.bank_amount-s.amount) order by s.recorded_at desc)
      from actv_payments.settlements s
      cross join lateral (select sum(x.net) as total,count(*) filter (where x.source like 'ch_%' and c.order_id is null) as unmatched
        from actv_payments.settlement_lines x
        left join actv_payments.captures c on (c.account_id,c.live_mode,c.charge_id)=(x.account_id,x.live_mode,x.source)
        where (x.account_id,x.live_mode,x.payout_id)=(s.account_id,s.live_mode,s.payout_id)) l
      where s.recorded_at>=v_from and s.recorded_at<v_until),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'state',o.state,
      'channel',o.channel,'amount',o.amount,'live_mode',o.live_mode) order by o.created_at desc)
      from actv_payments.orders o where o.created_at>=v_from and o.created_at<v_until
        and (o.state='review' or (o.state='pending' and o.expires_at<=now()))),'[]'::jsonb),
    'webhooks',coalesce((select jsonb_agg(to_jsonb(b)) from (
      select live_mode,count(*) as pending,count(*) filter (where failure_code is not null) as failed,
        min(received_at) as oldest
      from actv_payments.provider_events where processed_at is null group by live_mode
    ) b),'[]'::jsonb)
  );
end $$;

create function public.actv_availability(p_event_ids uuid[])
returns table(event_id uuid,used bigint) language sql stable security definer set search_path='' as $$
  select e.id,actv_payments.used(e.id) from public.eventos e
    where e.id=any(p_event_ids) and actv_payments.can_sell(auth.uid(),e.id) limit 1000
$$;

revoke all on function public.actv_create_staff_order(uuid,uuid,text,jsonb,boolean),public.actv_staff_order_status(uuid),
  public.actv_cash_shift(),public.actv_open_shift(bigint),public.actv_confirm_cash(uuid,uuid,bigint),
  public.actv_cancel_cash(uuid),public.actv_close_shift(uuid,bigint),
  public.actv_match_cash_deposit(uuid,text,bigint),public.actv_match_bank(text,boolean,text,text,bigint),
  public.actv_reconciliation(date,date),public.actv_availability(uuid[]) from public,anon,authenticated;
revoke all on function actv_payments.shift_json(uuid) from public,anon,authenticated;
grant execute on function public.actv_create_staff_order(uuid,uuid,text,jsonb,boolean),public.actv_staff_order_status(uuid),
  public.actv_cash_shift(),public.actv_open_shift(bigint),public.actv_confirm_cash(uuid,uuid,bigint),
  public.actv_cancel_cash(uuid),public.actv_close_shift(uuid,bigint),
  public.actv_match_cash_deposit(uuid,text,bigint),public.actv_match_bank(text,boolean,text,text,bigint),
  public.actv_reconciliation(date,date),public.actv_availability(uuid[]) to authenticated;
commit;

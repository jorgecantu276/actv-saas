begin;

alter table actv_payments.events
  add column live_commission_enabled boolean not null default false,
  add constraint actv_live_commission_requires_live_event
    check (not live_commission_enabled or live_mode);

-- Replace the check added with the sandbox application fee. Existing orders keep their snapshots.
alter table actv_payments.orders
  drop constraint orders_check2,
  add constraint actv_order_application_fee_valid check (
    application_fee_amount >= 0 and application_fee_amount < amount
    and (application_fee_amount = 0 or channel in ('online','terminal'))
    and (not live_mode or application_fee_amount in (0, 1500 * item_count))
  );

drop trigger actv_sandbox_application_fee on actv_payments.orders;
drop function actv_payments.set_sandbox_application_fee();

create function actv_payments.snapshot_application_fee() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.application_fee_amount := 0;
  if new.channel in ('online','terminal') then
    select new.item_count * case
      when new.live_mode and live_commission_enabled then 1500
      when not new.live_mode then sandbox_fee_per_folio
      else 0
    end into new.application_fee_amount
    from actv_payments.events where event_id = new.event_id;
  end if;
  return new;
end $$;

create trigger actv_snapshot_application_fee before insert on actv_payments.orders
for each row execute function actv_payments.snapshot_application_fee();

-- A larger item in the same checkout must not hide an underpriced live folio.
create function actv_payments.validate_live_commission_price() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.amount <= 1500 and exists (
    select 1 from actv_payments.orders
    where id = new.order_id and live_mode and application_fee_amount > 0
  ) then
    raise exception 'El precio del folio con tarjeta debe ser mayor que la comisión de ACTV'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger actv_validate_live_commission_price before insert or update of amount, order_id on actv_payments.items
for each row execute function actv_payments.validate_live_commission_price();

revoke all on function actv_payments.snapshot_application_fee(),
  actv_payments.validate_live_commission_price() from public, anon, authenticated;

create or replace function public.actv_catalog(p_event_id uuid default null,p_slug text default null)
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
      and (not c.live_commission_enabled or price > 15)
  ) p
  where ((p_event_id is not null and e.id=p_event_id)
    or (p_event_id is null and (c.slug=p_slug or e.id::text=p_slug)))
    and e.activo and e.fecha >= (now() at time zone 'America/Matamoros')::date
    and c.online_enabled and a.ready and p.options is not null
  order by (c.slug=p_slug) desc nulls last limit 1
$$;

commit;

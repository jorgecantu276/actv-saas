alter table actv_payments.events
  add column sandbox_fee_per_folio bigint not null default 0
  check (sandbox_fee_per_folio >= 0 and (not live_mode or sandbox_fee_per_folio = 0));

alter table actv_payments.orders
  add column application_fee_amount bigint not null default 0
  check (application_fee_amount >= 0 and application_fee_amount < amount
    and (application_fee_amount = 0 or (not live_mode and channel in ('online','terminal'))));

create function actv_payments.set_sandbox_application_fee() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.live_mode and new.channel in ('online','terminal') then
    select sandbox_fee_per_folio * new.item_count into new.application_fee_amount
    from actv_payments.events where event_id = new.event_id;
  end if;
  return new;
end $$;

create trigger actv_sandbox_application_fee before insert on actv_payments.orders
for each row execute function actv_payments.set_sandbox_application_fee();

create or replace function actv_payments.order_json(p_order uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'order_id',o.id,'status_token',o.status_token,'channel',o.channel,'state',o.state,
    'amount',o.amount,'currency',o.currency,'account_id',o.account_id,'live_mode',o.live_mode,
    'reader_id',o.reader_id,'expires_at',o.expires_at,'provider_session_id',o.provider_session_id,
    'provider_payment_id',o.provider_payment_id,'event_id',o.event_id,'buyer_email',o.buyer_email,
    'application_fee_amount',o.application_fee_amount,
    'items',(select jsonb_agg(jsonb_build_object('name',i.name,'amount',i.amount) order by i.number)
             from actv_payments.items i where i.order_id=o.id),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'created_at',r.created_at,'folio_asignado',r.folio_asignado,
        'monto_pagado',r.monto_pagado,'paquete_comprado',r.paquete_comprado) order by i.number)
      from actv_payments.items i join public.inscripciones r on r.actv_order_item_id=i.id
      where i.order_id=o.id and o.state='issued' and r.actv_eligible),'[]'::jsonb)
  )
  from actv_payments.orders o where o.id=p_order
$$;

-- Expose the immutable order origin for bounded canonical-provider recovery.
begin;

create or replace function actv_payments.order_json(p_order uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'order_id',o.id,'created_at',o.created_at,'status_token',o.status_token,'channel',o.channel,'state',o.state,
    'amount',o.amount,'currency',o.currency,'account_id',o.account_id,'live_mode',o.live_mode,
    'reader_id',o.reader_id,'expires_at',o.expires_at,'provider_session_id',o.provider_session_id,
    'provider_payment_id',o.provider_payment_id,'event_id',o.event_id,'buyer_email',o.buyer_email,
    'provider',o.payment_provider,'mercadopago_collector_id',o.mercadopago_collector_id,
    'provider_preference_id',o.mercadopago_preference_id,'mercadopago_payment_id',o.mercadopago_payment_id,
    'mercadopago_claim_id',o.mercadopago_claim_id,
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

commit;


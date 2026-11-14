import { field, HttpError, liveMode, rpc, uuid } from './http.ts';

export interface Registration {
  id: string;
  created_at: string;
  folio_asignado: string;
  monto_pagado: number;
  paquete_comprado: string;
}

export interface Order {
  order_id: string;
  status_token: string;
  state: 'pending' | 'issued' | 'closed' | 'review' | 'voided';
  channel: 'online' | 'terminal' | 'cash';
  amount: number;
  currency: string;
  account_id: string | null;
  live_mode: boolean;
  reader_id: string | null;
  expires_at: string;
  items: { name: string; amount: number }[];
  provider_session_id: string | null;
  provider_payment_id: string | null;
  registrations?: Registration[];
}

export function orderResult(order: Order) {
  const registrations = order.state === 'issued' ? order.registrations ?? [] : [];
  return {
    orderId: order.order_id,
    status: order.state,
    amount: order.amount,
    currency: order.currency,
    folios: registrations.map((item) => item.folio_asignado),
    registrations,
  };
}

export function providerContext(order: Order, channel: 'online' | 'terminal'): string {
  if (
    order.channel !== channel || order.live_mode !== liveMode() ||
    !order.account_id?.startsWith('acct_') || order.currency.toLowerCase() !== 'mxn'
  ) {
    throw new HttpError(409, 'payment_channel_unavailable');
  }
  return order.account_id;
}

export function getOrder(orderId: string, statusToken: string | null, userId: string | null) {
  return rpc<Order>('actv_order_status', {
    p_order_id: orderId,
    p_status_token: statusToken,
    p_operator: userId,
  });
}

export function createOrder(args: {
  eventId: string;
  requestId: string;
  channel: 'online' | 'terminal';
  items: unknown[];
  operator: string | null;
  relay: boolean;
  email: string | null;
}) {
  return rpc<Order>('actv_create_order', {
    p_event_id: args.eventId,
    p_request_id: args.requestId,
    p_channel: args.channel,
    p_items: args.items,
    p_operator: args.operator,
    p_relay: args.relay,
    p_buyer_email: args.email,
    p_live_mode: liveMode(),
  });
}

export function parseItems(value: unknown, staff: boolean): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpError(400, 'invalid_participants');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || (item.package !== 1 && item.package !== 2)) {
      throw new HttpError(400, 'invalid_participants');
    }
    if (staff) return { athlete_id: uuid(item.athlete_id), package: item.package };
    return {
      nombre: field(item.nombre, 100),
      apellido: field(item.apellido, 100),
      telefono: field(item.telefono, 35),
      telefono_emergencia: field(item.telefono_emergencia, 35),
      talla_playera: field(item.talla_playera, 30),
      package: item.package,
    };
  });
}

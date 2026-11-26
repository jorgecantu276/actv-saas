import { body, buyerEmail, db, field, handler, HttpError, liveMode, rpc, uuid } from '../_shared/http.ts';
import {
  mercadoPagoEnabled,
  startMercadoPagoCheckout,
  syncMercadoPagoCheckout,
} from '../_shared/mercado-pago-checkout.ts';
import {
  createOrder,
  getOrder,
  type Order,
  orderResult,
  parseItems,
  providerContext,
} from '../_shared/orders.ts';
import {
  attachProvider,
  createCheckoutSession,
  objectId,
  type Stripe,
  stripeClient,
  stripeOptions,
  stripeRedirect,
  syncCheckout,
} from '../_shared/stripe.ts';

interface Catalog {
  event_id: string;
  slug: string;
  name: string;
  date: string;
  description: string | null;
  available: number | null;
  currency: string;
  payment_providers?: ('stripe' | 'mercadopago')[];
  packages: Array<{ package: number; name: string; amount: number; currency?: string }>;
  registration_policy?: Record<string, unknown>;
}

async function createBoundCheckout(stripe: Stripe, order: Order, account: string) {
  const session = await createCheckoutSession(stripe, order, account);
  // Stripe may return the initial idempotent response for a session that has since completed.
  // Persist its identity, then read its current status before returning any Checkout URL.
  await attachProvider(order, account, session.id, objectId(session.payment_intent));
  return session.id;
}

async function refreshCheckout(stripe: Stripe, order: Order, account: string, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {}, stripeOptions(account));
  if (session.id !== sessionId) throw new HttpError(409, 'provider_checkout_mismatch');
  if (session.status === 'open' && session.url && session.livemode === order.live_mode) {
    return { order, checkoutUrl: stripeRedirect(session.url, 'checkout.stripe.com') };
  }
  const updated = await syncCheckout(stripe, account, sessionId, order.order_id);
  return { order: updated ?? order };
}

async function onlineStatus(order: Order, checkoutUrl?: string) {
  const { registrations: _registrations, ...result } = orderResult(order);
  if (!result.folios.length || !order.event_id) return { ...result, checkoutUrl };

  // The order has already been authorized by its private status token.
  const { data } = await db().from('eventos').select('nombre_carrera,fecha,distancia')
    .eq('id', order.event_id).abortSignal(AbortSignal.timeout(2000)).maybeSingle();
  return {
    ...result,
    race: data?.nombre_carrera ? { name: data.nombre_carrera, date: data.fecha, distance: data.distancia } : undefined,
  };
}

export const checkoutHandler = handler('actv-checkout', async (request) => {
  const input = await body(request);
  if (input.action === 'event') {
    const slug = field(input.slug, 160);
    const catalog = await rpc<Catalog | null>('actv_catalog', { p_slug: slug });
    if (!catalog) throw new HttpError(404, 'event_not_found');
    const { event_id, name, date, description, available, currency, packages } = catalog;
    return {
      event: {
        id: event_id,
        slug: catalog.slug,
        name,
        date,
        description,
        available,
        registrationPolicy: catalog.registration_policy,
        paymentProviders: (catalog.payment_providers ?? ['stripe']).filter((provider) =>
          provider === 'stripe' || mercadoPagoEnabled()
        ),
        options: packages.map((item) => ({
          id: item.package,
          name: item.name,
          amountMinor: item.amount,
          currency: item.currency ?? currency,
        })),
      },
    };
  }
  if (input.action === 'status' || input.action === 'resume') {
    let order = await getOrder(uuid(input.orderId), uuid(input.orderToken), null);
    if (order.channel !== 'online') throw new HttpError(404, 'record_not_found');
    if (order.provider === 'mercadopago') {
      if (
        order.state === 'pending' && typeof input.paymentId === 'string' &&
        /^[1-9]\d{0,18}$/.test(input.paymentId)
      ) {
        order = await syncMercadoPagoCheckout(order, input.paymentId);
      }
      if (input.action === 'resume' && order.state === 'pending') {
        return onlineStatus(order, (await startMercadoPagoCheckout(order))?.checkoutUrl);
      }
      return onlineStatus(order);
    }
    if (input.action === 'resume' && order.state === 'pending') {
      const account = providerContext(order, 'online');
      const stripe = stripeClient();
      const sessionId = order.provider_session_id ?? await createBoundCheckout(stripe, order, account);
      const current = await refreshCheckout(stripe, order, account, sessionId);
      return onlineStatus(current.order, current.checkoutUrl);
    }
    return onlineStatus(order);
  }
  if (input.action !== 'start') throw new HttpError(400, 'invalid_action');

  const email = buyerEmail(input.buyerEmail);
  if (input.provider !== undefined && input.provider !== 'stripe' && input.provider !== 'mercadopago') {
    throw new HttpError(400, 'invalid_provider');
  }
  if (input.provider === 'mercadopago') {
    if (!mercadoPagoEnabled()) throw new HttpError(503, 'mercadopago_not_available');
    const order = await rpc<Order>('actv_create_mercadopago_order', {
      p_event_id: uuid(input.eventId),
      p_request_id: uuid(input.idempotencyKey),
      p_items: parseItems(input.participants, false),
      p_buyer_email: email.toLowerCase(),
      p_live_mode: liveMode(),
    });
    const { registrations: _registrations, ...result } = orderResult(order);
    return {
      ...result,
      orderToken: order.status_token,
      checkoutUrl: order.state === 'pending'
        ? (await startMercadoPagoCheckout(order))?.checkoutUrl
        : undefined,
    };
  }
  const stripe = stripeClient();
  const order = await createOrder({
    eventId: uuid(input.eventId),
    requestId: uuid(input.idempotencyKey),
    channel: 'online',
    items: parseItems(input.participants, false),
    operator: null,
    relay: false,
    email: email.toLowerCase(),
  });
  const account = providerContext(order, 'online');
  const { registrations: _registrations, ...result } = orderResult(order);
  const response = { ...result, orderToken: order.status_token };
  if (order.state !== 'pending') return response;

  const sessionId = order.provider_session_id ?? await createBoundCheckout(stripe, order, account);
  const current = await refreshCheckout(stripe, order, account, sessionId);
  const { registrations: _current, ...currentResult } = orderResult(current.order);
  return { ...currentResult, orderToken: order.status_token, checkoutUrl: current.checkoutUrl };
}, true);

export default { fetch: checkoutHandler };

import { appOrigin, body, buyerEmail, field, handler, HttpError, rpc, uuid } from '../_shared/http.ts';
import { createOrder, getOrder, orderResult, parseItems, providerContext } from '../_shared/orders.ts';
import {
  attachProvider,
  objectId,
  orderMetadata,
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
  packages: Array<{ package: number; name: string; amount: number; currency?: string }>;
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
    const order = await getOrder(uuid(input.orderId), uuid(input.orderToken), null);
    if (order.channel !== 'online') throw new HttpError(404, 'record_not_found');
    const { registrations: _registrations, ...result } = orderResult(order);
    if (input.action === 'resume' && order.state === 'pending' && order.provider_session_id) {
      const account = providerContext(order, 'online');
      const stripe = stripeClient();
      const session = await stripe.checkout.sessions.retrieve(
        order.provider_session_id,
        {},
        stripeOptions(account),
      );
      if (session.status === 'open' && session.livemode === order.live_mode && session.url) {
        return { ...result, checkoutUrl: stripeRedirect(session.url, 'checkout.stripe.com') };
      }
    }
    return result;
  }
  if (input.action !== 'start') throw new HttpError(400, 'invalid_action');

  const stripe = stripeClient();
  const origin = appOrigin();
  const email = buyerEmail(input.buyerEmail);
  const order = await createOrder({
    eventId: uuid(input.eventId),
    requestId: uuid(input.idempotencyKey),
    channel: 'online',
    items: parseItems(input.participants, false),
    operator: null,
    relay: false,
    email,
  });
  const account = providerContext(order, 'online');
  const { registrations: _registrations, ...result } = orderResult(order);
  const response = { ...result, orderToken: order.status_token };
  if (order.state !== 'pending') return response;

  if (order.provider_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      order.provider_session_id,
      {},
      stripeOptions(account),
    );
    if (session.status === 'open' && session.url && session.livemode === order.live_mode) {
      return { ...response, checkoutUrl: stripeRedirect(session.url, 'checkout.stripe.com') };
    }
    const updated = await syncCheckout(stripe, account, session.id, order.order_id);
    if (!updated) return response;
    const { registrations: _updated, ...updatedResult } = orderResult(updated);
    return { ...updatedResult, orderToken: order.status_token };
  }

  const expiresAt = Math.floor(Date.parse(order.expires_at) / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) + 1_805) {
    throw new HttpError(409, 'reservation_checkout_window_closed');
  }
  const success = new URL('/registro/estado', origin);
  success.searchParams.set('orden', order.order_id);
  success.hash = new URLSearchParams({ token: order.status_token }).toString();
  const cancel = new URL(success);
  cancel.searchParams.set('cancelado', '1');
  const metadata = orderMetadata(order);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    allowed_payment_method_types: ['card'],
    client_reference_id: order.order_id,
    customer_email: email,
    success_url: success.href,
    cancel_url: cancel.href,
    expires_at: expiresAt,
    metadata,
    payment_intent_data: { metadata },
    line_items: order.items.map((item) => ({
      quantity: 1,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: item.amount,
        product_data: { name: item.name },
      },
    })),
  }, stripeOptions(account, `actv-checkout-${order.order_id}`));
  if (
    !session.url || session.livemode !== order.live_mode || session.amount_total !== order.amount ||
    session.currency !== order.currency.toLowerCase()
  ) {
    throw new HttpError(409, 'provider_checkout_mismatch');
  }
  await attachProvider(order, account, session.id, objectId(session.payment_intent));
  return { ...response, checkoutUrl: stripeRedirect(session.url, 'checkout.stripe.com') };
}, true);

export default { fetch: checkoutHandler };

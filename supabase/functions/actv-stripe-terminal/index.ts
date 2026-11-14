import { body, handler, HttpError, operator, uuid } from '../_shared/http.ts';
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
  cancelTerminal,
  orderMetadata,
  providerOrderId,
  readerAction,
  type Stripe,
  stripeClient,
  stripeErrorCode,
  stripeOptions,
  syncTerminal,
} from '../_shared/stripe.ts';

async function createIntent(stripe: Stripe, order: Order, account: string): Promise<string> {
  const intent = await stripe.paymentIntents.create({
    currency: order.currency.toLowerCase(),
    amount: order.amount,
    allowed_payment_method_types: ['card_present'],
    capture_method: 'automatic',
    metadata: orderMetadata(order),
  }, stripeOptions(account, `actv-terminal-intent-${order.order_id}`));
  if (
    intent.livemode !== order.live_mode || intent.amount !== order.amount ||
    intent.currency !== order.currency.toLowerCase() ||
    providerOrderId(intent.metadata, 'terminal') !== order.order_id
  ) {
    throw new HttpError(409, 'provider_terminal_mismatch');
  }
  await attachProvider(order, account, null, intent.id);
  return intent.id;
}

export const terminalHandler = handler('actv-stripe-terminal', async (request) => {
  const userId = await operator(request);
  const input = await body(request);
  const action = input.action;
  if (action !== 'start' && action !== 'retry' && action !== 'status' && action !== 'cancel') {
    throw new HttpError(400, 'invalid_action');
  }

  const stripe = stripeClient();
  let order = action === 'start' && !input.orderId
    ? await createOrder({
      eventId: uuid(input.eventId),
      requestId: uuid(input.idempotencyKey),
      channel: 'terminal',
      items: parseItems(input.participants, true),
      operator: userId,
      relay: input.relay === true,
      email: null,
    })
    : await getOrder(uuid(input.orderId), null, userId);
  const account = providerContext(order, 'terminal');
  const readerId = order.reader_id;
  if (!readerId?.startsWith('tmr_')) throw new HttpError(409, 'terminal_not_configured');
  if (order.state !== 'pending') return orderResult(order);

  try {
    let paymentId = order.provider_payment_id;
    let providerStatus: string | null = null;
    if (action === 'start' || action === 'retry') {
      if (Date.parse(order.expires_at) <= Date.now()) throw new HttpError(409, 'reservation_expired');
      if (!paymentId && action === 'retry') throw new HttpError(409, 'terminal_payment_not_started');

      const reader = await stripe.terminal.readers.retrieve(readerId, {}, stripeOptions(account));
      if ('deleted' in reader || reader.livemode !== order.live_mode || reader.status !== 'online') {
        throw new HttpError(409, 'terminal_reader_unavailable');
      }
      if (!paymentId) {
        paymentId = await createIntent(stripe, order, account);
      }

      const current = await syncTerminal(stripe, account, paymentId, order.order_id);
      if (current.order) return { ...orderResult(current.order), provider_status: current.intent.status };
      providerStatus = current.intent.status;
      const readerStatus = readerAction(reader, paymentId);
      if (
        providerStatus !== 'requires_payment_method' || reader.action?.status === 'in_progress' ||
        (action === 'retry' && readerStatus !== 'failed')
      ) {
        return { ...orderResult(order), provider_status: providerStatus, readerStatus };
      }
      const attempt = action === 'retry' ? uuid(input.idempotencyKey) : 'initial';
      const active = await stripe.terminal.readers.processPaymentIntent(readerId, {
        payment_intent: paymentId,
        process_config: { enable_customer_cancellation: true },
      }, stripeOptions(account, `actv-terminal-reader-${order.order_id}-${attempt}`));
      return {
        ...orderResult(order),
        provider_status: providerStatus,
        readerStatus: readerAction(active, paymentId),
      };
    }

    if (!paymentId && action === 'cancel') {
      // Order creation can be interrupted between provider intent creation and DB attachment.
      // Recover the canonical intent through the same provider idempotency key before closing.
      paymentId = await createIntent(stripe, order, account);
    }
    if (!paymentId) return { ...orderResult(order), provider_status: null };

    const current = await syncTerminal(stripe, account, paymentId, order.order_id);
    if (current.order) return { ...orderResult(current.order), provider_status: current.intent.status };
    if (action === 'cancel') {
      const final = await cancelTerminal(stripe, account, readerId, current.intent, order.order_id);
      if (final?.order) order = final.order;
      return { ...orderResult(order), provider_status: final?.intent.status ?? current.intent.status };
    }
    const reader = await stripe.terminal.readers.retrieve(readerId, {}, stripeOptions(account));
    return {
      ...orderResult(order),
      provider_status: current.intent.status,
      readerStatus: readerAction(reader, paymentId),
    };
  } catch (error) {
    const code = stripeErrorCode(error);
    console.error(JSON.stringify({ component: 'actv-stripe-terminal', action, code }));
    return { ...orderResult(order), provider_status: null, providerError: code };
  }
}, true);

export default { fetch: terminalHandler };

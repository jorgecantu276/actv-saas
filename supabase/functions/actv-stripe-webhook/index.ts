import { boundedBody, env, handler, HttpError, liveMode, rpc } from '../_shared/http.ts';
import {
  acknowledgeEvent,
  applyEvent,
  completeEvent,
  type EventRetry,
  eventTypes,
  noteFailedEvent,
  recordEvent,
  type StoredEvent,
} from '../_shared/stripe-events.ts';
import { providerOrderId, Stripe, stripeClient, stripeErrorCode } from '../_shared/stripe.ts';

type BackgroundGlobal = typeof globalThis & { EdgeRuntime?: { waitUntil: (work: Promise<void>) => void } };

async function processReceivedEvent(stripe: Stripe, notice: StoredEvent) {
  const identity = {
    p_live_mode: notice.live_mode,
    p_account_id: notice.account_id,
    p_event_id: notice.event_id,
  };
  try {
    const claimed = await rpc<EventRetry | null>('actv_claim_received_stripe_event', identity);
    if (!claimed) return;
    let failure: string | null = null;
    try {
      await applyEvent(stripe, claimed);
    } catch (error) {
      failure = stripeErrorCode(error);
    }
    const acknowledged = await acknowledgeEvent(claimed, failure);
    if (acknowledged && failure) {
      console.error(JSON.stringify({ component: 'actv-stripe-webhook', code: failure }));
    }
  } catch (error) {
    console.error(JSON.stringify({ component: 'actv-stripe-webhook', code: stripeErrorCode(error) }));
  }
}

export async function signedEvent(stripe: Stripe, raw: string, signature: string, secret: string) {
  try {
    return await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      secret,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HttpError(400, 'invalid_webhook_signature');
  }
}

export const webhookHandler = handler('actv-stripe-webhook', async (request) => {
  const stripe = stripeClient();
  const signature = request.headers.get('stripe-signature');
  if (!signature) throw new HttpError(400, 'invalid_webhook_signature');
  const raw = await boundedBody(request, 524_288);
  const event = await signedEvent(stripe, raw, signature, env('ACTV_STRIPE_WEBHOOK_SECRET'));
  const account = event.account;
  if (!eventTypes.has(event.type) || !account?.startsWith('acct_') || event.livemode !== liveMode()) {
    return { received: true, ignored: true };
  }

  const object = event.data.object as { id: string; metadata?: Stripe.Metadata };
  const isCheckout = event.type.startsWith('checkout.session.');
  const isIntent = event.type.startsWith('payment_intent.');
  const orderId = isCheckout
    ? providerOrderId(object.metadata ?? null, 'online')
    : isIntent
    ? providerOrderId(object.metadata ?? null, 'terminal')
    : null;
  if ((isCheckout || isIntent) && !orderId) return { received: true, ignored: true };
  const record = {
    account_id: account,
    live_mode: event.livemode,
    event_id: event.id,
    event_type: event.type,
    object_id: object.id,
    order_id: orderId,
  };
  const result = await recordEvent(record);
  if (result.processed) return { received: true, duplicate: true };
  const runtime = (globalThis as BackgroundGlobal).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(processReceivedEvent(stripe, record));
    return { received: true, queued: true };
  }
  try {
    await completeEvent(stripe, record);
  } catch (error) {
    const code = stripeErrorCode(error);
    await noteFailedEvent(record, code);
    console.error(JSON.stringify({ component: 'actv-stripe-webhook', code }));
    throw new HttpError(503, 'webhook_processing_pending');
  }
  return { received: true };
});

export default { fetch: webhookHandler };

import { handler, HttpError, rpc, uuid } from '../_shared/http.ts';
import { verifyMercadoPagoWebhook } from '../_shared/mercado-pago.ts';
import { mercadoPagoConfig, syncMercadoPagoCheckout } from '../_shared/mercado-pago-checkout.ts';
import type { Order } from '../_shared/orders.ts';

export const webhookHandler = handler('actv-mercadopago-webhook', async (request) => {
  const { webhookSecret } = mercadoPagoConfig();
  const notice = await verifyMercadoPagoWebhook(request, webhookSecret);
  const references = new URL(request.url).searchParams.getAll('order_id');
  if (references.length !== 1) throw new HttpError(400, 'mercadopago_order_required');
  const order = await rpc<Order | null>('actv_read_order', { p_order_id: uuid(references[0]) });
  if (!order || order.provider !== 'mercadopago') return { received: true, ignored: true };
  await syncMercadoPagoCheckout(order, notice.paymentId);
  return { received: true };
});

export default { fetch: webhookHandler };

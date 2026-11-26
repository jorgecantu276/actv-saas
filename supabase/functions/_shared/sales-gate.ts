import { rpc } from './http.ts';

export async function authorizeProviderAttempt(
  orderId: string,
  kind: 'checkout' | 'terminal_intent' | 'terminal_reader',
  attempt = 'canonical',
) {
  await rpc<boolean>('actv_authorize_provider_attempt', {
    p_order_id: orderId, p_kind: kind, p_attempt: attempt,
  });
}

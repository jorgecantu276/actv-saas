import { FunctionsHttpError, type FunctionInvokeOptions } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type PackageNumber = 1 | 2;

export type Race = {
  id: string;
  name: string;
  date?: string | null;
  description?: string | null;
  available: number | null;
  limits?: { maxParticipants?: number };
  options: { id: PackageNumber; name: string; amountMinor: number; currency: string }[];
};

export type OrderStatus = { status: 'pending' | 'issued' | 'closed' | 'review' | 'voided'; folios: string[] };
export type StartedOrder = OrderStatus & { orderId: string; orderToken: string; checkoutUrl?: string | null };

export class PaymentsError extends Error {
  constructor(readonly status: number) {
    super('No se pudo completar la solicitud.');
  }
}

export async function paymentFunction<T>(
  name: 'actv-checkout' | 'actv-organizer-connect',
  body: NonNullable<FunctionInvokeOptions['body']>,
  signal?: AbortSignal,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body, signal, timeout: 25_000 });
  if (error) throw new PaymentsError(error instanceof FunctionsHttpError ? error.context.status : 0);
  if (!data) throw new PaymentsError(0);
  return data;
}

export const formattedPrice = (amount: number, currency: string) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);

export const orderStatusPath = (orderId: string, orderToken: string) =>
  `/registro/estado?orden=${encodeURIComponent(orderId)}#token=${encodeURIComponent(orderToken)}`;

export function goToStripe(link: string, purpose: 'checkout' | 'onboarding') {
  const url = new URL(link);
  const hostname = purpose === 'checkout' ? 'checkout.stripe.com' : 'connect.stripe.com';
  if (url.protocol !== 'https:' || url.hostname !== hostname) throw new PaymentsError(0);
  window.location.assign(url.href);
}

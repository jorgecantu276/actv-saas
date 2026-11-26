import { supabase } from './supabase';

export interface SaleReceipt {
  receipt_id: string;
  order_id: string | null;
  event_id: string;
  event_name: string;
  event_date: string | null;
  issued_at: string | null;
  payment_status: 'confirmed' | 'payment_unverified';
  amount_minor: number | null;
  recorded_amount?: string | number | null;
  currency: string;
  channel: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  participants: { registration_id: string; athlete_id: string; folio: string;
    package: string | null; amount_minor: number | null; name: string; surname: string;
    phone: string | null; shirt_size: string | null; club: string | null }[];
}

export type ReceiptIdentity = { p_order_id: string } | { p_registration_id: string }
  | { p_event_id: string; p_folio: string };

export async function loadSaleReceipt(identity: ReceiptIdentity): Promise<SaleReceipt> {
  const { data, error } = await supabase.rpc('actv_sale_receipt', identity);
  if (error) throw new Error(error.message);
  if (!data?.receipt_id || !Array.isArray(data.participants) || !data.participants.length) {
    throw new Error('Recibo no disponible; consulta la orden original.');
  }
  return data as SaleReceipt;
}

export function receiptAmount(receipt: SaleReceipt) {
  return receipt.payment_status === 'confirmed' && receipt.amount_minor !== null
    ? `$${(receipt.amount_minor / 100).toFixed(2)} MXN`
    : `${receipt.recorded_amount ?? 'Desconocido'} MXN (importe histórico sin validar)`;
}

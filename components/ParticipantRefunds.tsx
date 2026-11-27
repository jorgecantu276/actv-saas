'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { paymentFunction } from '@/app/_pagos/api';
import styles from './AdminPayments.module.css';

type Refund = { id: string; item_ids: string[]; amount: number; status: string; reason: string; participant_scoped: boolean; refund_application_fee: boolean };
type Detail = { id: string; channel: string; provider: string; shift: { id: string } | null;
 financial: { captured: number; refunded: number; pending: number; hold: boolean };
 items: { id: string; name: string; participant_name: string | null; number: number; registration_id: string | null;
 folio: string | null; amount: number; eligible: boolean; refunded: number; reserved: boolean }[]; requests: Refund[] };
const money = (v: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v / 100);
const participantLabel = (item: Detail['items'][number]) => `${item.folio ? `Folio ${item.folio}` : `Participante ${item.number}`} · ${item.participant_name ?? 'Nombre no registrado'}`;
export default function ParticipantRefunds({ orderId, registrationId, onChanged }: { orderId?: string; registrationId?: string; onChanged?: () => void }) {
 return <RefundBody key={`${orderId ?? ''}:${registrationId ?? ''}`} orderId={orderId} registrationId={registrationId} onChanged={onChanged} />;
}
function RefundBody({ orderId, registrationId, onChanged }: { orderId?: string; registrationId?: string; onChanged?: () => void }) {
 const [data, setData] = useState<Detail | null>(null);
 const [items, setItems] = useState<string[]>([]);
 const [reason, setReason] = useState('');
 const [scoped, setScoped] = useState(false);
 const [fee, setFee] = useState(false);
 const [confirmed, setConfirmed] = useState(false);
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const [revision, setRevision] = useState(0);
 const [requestId, setRequestId] = useState<string | null>(null);
 useEffect(() => { let active = true;
  void supabase.rpc('actv_participant_refund_detail', { p_order_id: orderId ?? null, p_registration_id: registrationId ?? null })
   .then(({ data: value, error }) => { if (active) { setData(error ? null : value); if (error) setMessage('Solo un gerente puede consultar o efectuar reembolsos.'); } });
  return () => { active = false; };
 }, [orderId, registrationId, revision]);
 async function submit(existing?: Refund) {
  if (!data || busy) return;
  const id = existing?.id ?? requestId ?? crypto.randomUUID();
  setRequestId(id); setBusy(true); setMessage('');
  try {
   if (data.channel === 'cash') {
    if (!data.shift) throw new Error('Abre una caja antes de entregar el efectivo.');
    const { error } = await supabase.rpc('actv_cash_participant_refund', { p_order: data.id, p_request: id,
     p_items: existing?.item_ids ?? items, p_reason: existing?.reason ?? reason,
     p_participant_scoped: existing?.participant_scoped ?? scoped, p_shift: data.shift.id, p_disbursed: confirmed });
    if (error) throw error;
   } else await paymentFunction('actv-admin-payments', { action: 'participant-refund', orderId: data.id, requestId: id,
    itemIds: existing?.item_ids ?? items, reason: existing?.reason ?? reason, participantScoped: existing?.participant_scoped ?? scoped,
    refundCommission: existing?.refund_application_fee ?? fee, confirmed: true });
   setMessage('Operación consultada. Revisa el estado confirmado abajo.'); setItems([]); setConfirmed(false); setRequestId(null); onChanged?.();
  } catch { setMessage('No se confirmó la devolución. Recupera la misma solicitud; no crees otra. Para efectivo se requiere caja abierta con fondos.'); }
  finally { setRevision((r) => r + 1); setBusy(false); }
 }
 if (!data) return message ? <p role="status">{message}</p> : null;
 return <section aria-label="Reembolsos por participante" className={styles.refundForm}>
  <h3>Reembolsos por participante</h3>
  <p>Cobrado {money(data.financial.captured)} · Devuelto {money(data.financial.refunded)} · Reservado {money(data.financial.pending)}</p>
  {data.financial.hold && <p>Pedido retenido para revisión. Las devoluciones sin correspondencia y los contracargos requieren conciliación.</p>}
  <p>Los lugares y el historial de asistencia se conservan. No se crean nuevos folios.</p>
  {data.requests.map((r) => <div key={r.id}><strong>{money(r.amount)} · {r.status}</strong><p>{r.reason}</p><code>{r.id}</code>
   <ul>{data.items.filter(item => r.item_ids.includes(item.id)).map(item => <li key={item.id}>{participantLabel(item)} · {item.name} · {money(item.amount)}</li>)}</ul>
   <p>{r.participant_scoped ? 'Decisión registrada: conservar acceso de participantes no devueltos.' : 'Revisión de acceso del pedido completo.'}</p>
   {data.channel !== 'cash' && <button type="button" disabled={busy} onClick={() => void submit(r)}>Consultar / recuperar solicitud</button>}</div>)}
  {data.provider === 'mercadopago' ? <p>Gestiona la devolución en Mercado Pago y concilia su estado antes de habilitar accesos.</p> : <form onSubmit={(e) => { e.preventDefault(); if (confirmed) void submit(); }}>
   {data.items.map((i) => <label key={i.id} className={styles.check}><input type="checkbox" checked={items.includes(i.id)}
    disabled={busy || i.reserved || Boolean(requestId)} onChange={(e) => setItems(e.target.checked ? [...items, i.id] : items.filter((id) => id !== i.id))} />
    {participantLabel(i)} · {i.name} · {money(i.amount)} · {i.refunded ? 'Devuelto' : i.eligible ? 'Acceso financiero habilitado' : 'Acceso retenido'}</label>)}
   <p>Importe exacto: {money(data.items.filter((i) => items.includes(i.id)).reduce((sum, i) => sum + i.amount, 0))}</p>
   <label>Motivo y decisión de acceso<textarea required minLength={3} maxLength={500} value={reason} disabled={busy || Boolean(requestId)} onChange={(e) => setReason(e.target.value)} /></label>
   <label className={styles.check}><input type="checkbox" checked={scoped} disabled={busy || Boolean(requestId)} onChange={(e) => setScoped(e.target.checked)} />Autorizo conservar acceso de los participantes no devueltos; el motivo queda auditado.</label>
   {data.channel !== 'cash' && <label className={styles.check}><input type="checkbox" checked={fee} disabled={busy || Boolean(requestId)} onChange={(e) => setFee(e.target.checked)} />Solicitar a Stripe la reversión proporcional de la comisión al organizador.</label>}
   <p>{data.channel === 'cash' ? 'El gerente entrega el importe desde su caja abierta y registra la salida real para el corte.' : 'Stripe devuelve a la tarjeta original. El organizador debe disponer de fondos; una solicitud pendiente no acredita devolución.'}</p>
   <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />{data.channel === 'cash' ? 'Confirmo que entregué realmente este efectivo.' : 'Confirmo importe, participantes y devolución a la tarjeta original.'}</label>
   <button type="submit" disabled={busy || !confirmed || items.length === 0 || reason.trim().length < 3 || data.financial.captured === 0}>{busy ? 'Consultando…' : requestId ? 'Recuperar misma solicitud' : data.channel === 'cash' ? 'Registrar entrega de efectivo' : 'Solicitar devolución'}</button>
  </form>}
  {message && <p role="status">{message}</p>}
 </section>;
}

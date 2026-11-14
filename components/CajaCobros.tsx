'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export type Cart = {
  eventId: string;
  relay: boolean;
  items: { athlete_id: string; package: 1 | 2 }[];
};

type Channel = 'cash' | 'terminal';
type State = 'pending' | 'issued' | 'closed' | 'review' | 'voided';
type Registration = {
  id: string;
  created_at: string;
  folio_asignado: string;
  monto_pagado: string;
  paquete_comprado: string;
  atleta_id?: string;
};

export type StaffOrder = {
  order_id: string;
  state: State;
  amount: number;
  currency: string;
  expires_at: string;
  registrations?: Registration[];
};

type Draft = {
  cart: Cart;
  channel: Channel;
  requestId: string;
  order?: StaffOrder;
  received?: number;
  shiftId?: string;
  terminalTouched?: boolean;
  terminalRetry?: string;
};

type Shift = {
  id: string;
  opened_at?: string;
  opening: number;
  expected: number;
  state?: string;
  counted?: number;
  variance?: number;
};

const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const formatMoney = (amount: number) => currencyFormatter.format(amount / 100);

export function centavos(value: string): number | null {
  const valid = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!valid) return null;
  return Number(valid[1]) * 100 + Number((valid[2] ?? '').padEnd(2, '0'));
}

const buttons = 'rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-45';
const submit = `${buttons} bg-slate-900 text-white hover:bg-slate-800`;
const secondary = `${buttons} border border-slate-300 bg-white text-slate-800 hover:bg-slate-100`;
const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';

const orderLabels: Record<State, string> = {
  pending: 'Pendiente de confirmación',
  issued: 'Pago confirmado · folios emitidos',
  closed: 'Orden cerrada',
  review: 'Requiere conciliación',
  voided: 'Folios anulados',
};

const readerLabels: Record<string, string> = {
  failed: 'Cobro rechazado o cancelado',
  in_progress: 'Esperando al cliente',
  succeeded: 'Cobro aceptado · esperando confirmación',
  processing: 'Procesando',
  requires_payment_method: 'Esperando tarjeta',
  requires_capture: 'Esperando captura',
  canceled: 'Cancelado',
};

function readOrder(data: StaffOrder): StaffOrder {
  const { order_id, state, amount, currency, expires_at, registrations } = data;
  return { order_id, state, amount, currency, expires_at, registrations };
}

export default function CajaCobros({
  userId,
  cart,
  estimate,
  onLock,
  onReceipt,
}: {
  userId: string;
  cart: Cart | null;
  estimate: number;
  onLock: (locked: boolean) => void;
  onReceipt: (order: StaffOrder, cart: Cart, method: Channel) => void;
}) {
  const key = `actv-caja-cobro:${userId}`;
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [channel, setChannel] = useState<Channel>('cash');
  const [shift, setShift] = useState<Shift | null>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [shiftAmount, setShiftAmount] = useState('');
  const [tender, setTender] = useState('');
  const [message, setMessage] = useState('');
  const [reader, setReader] = useState<{ status: string | null; provider: string | null }>({ status: null, provider: null });
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const storeDraft = useCallback((value: Draft | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify({
      ...value, order: value.order ? { ...value.order, registrations: undefined } : undefined,
    }));
    else sessionStorage.removeItem(key);
    setDraft(value);
    onLock(Boolean(value));
  }, [key, onLock]);

  const readShift = useCallback(async () => {
    const { data, error } = await supabase.rpc('actv_cash_shift');
    if (error) throw error;
    setShift(data as Shift | null);
  }, []);

  useEffect(() => {
    let active = true;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const previous = JSON.parse(saved) as Draft;
        setDraft(previous);
        onLock(true);
        if (previous.received !== undefined) setTender((previous.received / 100).toFixed(2));
      }
      setReady(true);
    } catch {
      setMessage('La sesión local de Caja no está disponible. Recupera cualquier cobro con conciliación antes de continuar.');
    }
    void readShift().catch(() => {
      if (active) setMessage('No se pudo consultar el turno de Caja. Vuelve a consultar antes de cobrar en efectivo.');
    });
    return () => { active = false; };
  }, [key, onLock, readShift]);

  const run = async (operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setMessage('');
    try {
      await operation();
    } catch (error) {
      const detail = (error as { message?: string })?.message;
      setMessage(detail || 'No se pudo completar la operación. Consulta la orden existente antes de volver a cobrar.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const changeShift = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const amount = centavos(shiftAmount);
      if (amount === null) throw new Error('Escribe un importe MXN válido con hasta dos decimales.');
      if (shift) {
        const { data, error } = await supabase.rpc('actv_close_shift', { p_shift_id: shift.id, p_counted: amount });
        if (error) throw error;
        setClosedShift(data as Shift);
        setShift(null);
      } else {
        const { data, error } = await supabase.rpc('actv_open_shift', { p_opening: amount });
        if (error) throw error;
        setShift(data as Shift);
        setClosedShift(null);
      }
      setShiftAmount('');
    });
  };

  const createOrder = async (current: Draft) => {
    const { data, error } = await supabase.rpc('actv_create_staff_order', {
      p_event_id: current.cart.eventId,
      p_request_id: current.requestId,
      p_channel: current.channel,
      p_items: current.cart.items,
      p_relay: current.cart.relay,
    });
    if (error) {
      // A PostgreSQL statement error rolls back that request. Transport and gateway
      // errors preserve its original key so the operator can recover the same order.
      if (error.code === 'P0001' || error.code === '42501' || error.code?.startsWith('22')) storeDraft(null);
      throw error;
    }
    storeDraft({ ...current, order: readOrder(data as StaffOrder) });
  };

  const prepare = () => void run(async () => {
    if (draft) return createOrder(draft);
    if (!cart) return;
    if (channel === 'cash' && !shift) throw new Error('Abre un turno de Caja para cobrar en efectivo.');
    const attempt = { cart, channel, requestId: crypto.randomUUID() };
    storeDraft(attempt);
    await createOrder(attempt);
  });

  const refreshOrder = useCallback(async (current: Draft) => {
    const { data, error } = await supabase.rpc('actv_staff_order_status', { p_order_id: current.order?.order_id });
    if (error) throw error;
    storeDraft({ ...current, order: readOrder(data as StaffOrder) });
  }, [storeDraft]);

  useEffect(() => {
    if (draft?.channel !== 'terminal' || !draft.terminalTouched || draft.order?.state !== 'pending') return;
    const timer = window.setInterval(() => {
      if (Date.parse(draft.order!.expires_at) + 300_000 <= Date.now()) {
        window.clearInterval(timer);
        return;
      }
      if (busy.current || document.hidden) return;
      busy.current = true;
      void refreshOrder(draft)
        .catch(() => setMessage('No se pudo actualizar la orden. Usa Consultar estado antes de repetir el cobro.'))
        .finally(() => { busy.current = false; });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [draft, refreshOrder]);

  const confirmCash = () => void run(async () => {
    if (!draft?.order) return;
    const shiftId = draft.shiftId ?? shift?.id;
    if (!shiftId) return;
    const amount = draft.received ?? centavos(tender);
    if (amount === null || amount < draft.order.amount) throw new Error('El efectivo recibido debe cubrir el total de la orden.');
    if (amount > 100000000) throw new Error('El efectivo recibido supera el límite de caja.');
    if (draft.received === undefined && Date.parse(draft.order.expires_at) <= Date.now()) throw new Error('La orden venció. Cancélala antes de preparar otra.');
    const current = { ...draft, received: amount, shiftId };
    storeDraft(current);
    const { data, error } = await supabase.rpc('actv_confirm_cash', {
      p_order_id: draft.order.order_id,
      p_shift_id: current.shiftId,
      p_received: amount,
    });
    if (error) {
      if (error.code === 'P0001' || error.code?.startsWith('22')) {
        setMessage(`${error.message}. Consulta la orden y registra la incidencia antes de volver a cobrar.`);
        await refreshOrder(current);
        return;
      }
      throw error;
    }
    storeDraft({ ...current, order: readOrder(data as StaffOrder) });
    await readShift();
  });

  const cancelCash = () => void run(async () => {
    if (!draft?.order || draft.received !== undefined) return;
    const { data, error } = await supabase.rpc('actv_cancel_cash', { p_order_id: draft.order.order_id });
    if (error) throw error;
    storeDraft({ ...draft, order: readOrder(data as StaffOrder) });
  });

  const terminal = (action: 'start' | 'status' | 'retry' | 'cancel') => void run(async () => {
    if (!draft?.order) return;
    const retryId = action === 'retry' ? (draft.terminalRetry ?? crypto.randomUUID()) : undefined;
    const current = {
      ...draft,
      terminalTouched: true,
      terminalRetry: retryId ?? draft.terminalRetry,
    };
    storeDraft(current);
    const { data, error } = await supabase.functions.invoke('actv-stripe-terminal', {
      body: { action, orderId: draft.order.order_id, idempotencyKey: retryId },
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      const details = response instanceof Response ? await response.json().catch(() => null) : null;
      throw new Error(details?.error || 'No se pudo confirmar la respuesta de la terminal. Consulta el estado de esta orden antes de intentar otro cobro.');
    }
    setReader({ status: data.readerStatus ?? null, provider: data.provider_status ?? null });
    if (data.providerError) setMessage(`La terminal devolvió ${data.providerError}. Consulta su estado antes de intentar otro cobro.`);
    else if (action === 'cancel' && data.status === 'pending') {
      setMessage('El cobro sigue pendiente. Si la terminal espera la tarjeta, cancela en el dispositivo y vuelve a consultar esta orden.');
    }
    const retryFinished = !data.providerError && (
      (action === 'retry' && (data.readerStatus === 'failed' || data.readerStatus === 'in_progress')) ||
      (data.status && data.status !== 'pending')
    );
    await refreshOrder(retryFinished ? { ...current, terminalRetry: undefined } : current);
  });

  const finish = () => void run(async () => {
    if (!draft?.order) return;
    const { data, error } = await supabase.rpc('actv_staff_order_status', { p_order_id: draft.order.order_id });
    if (error) throw error;
    const current = readOrder(data as StaffOrder);
    if (current.state === 'issued' && current.registrations?.length) onReceipt(current, draft.cart, draft.channel);
    else if (current.state !== 'closed' && current.state !== 'voided') {
      storeDraft({ ...draft, order: current });
      setMessage('La orden no tiene folios vigentes para imprimir.');
      return;
    }
    storeDraft(null);
    setTender('');
    setReader({ status: null, provider: null });
    setMessage('');
  });

  const order = draft?.order;
  const cash = draft?.channel === 'cash';
  const subtotal = order ? formatMoney(order.amount) : formatMoney(estimate);
  const received = draft?.received ?? centavos(tender);
  const pending = order?.state === 'pending';
  const expired = pending && Date.parse(order.expires_at) <= Date.now();
  const hasUnresolvedTender = Boolean(draft && cash && draft.received !== undefined && pending);
  const readerLabel = reader.status ?? reader.provider;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="Turno de caja">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">Turno de caja</h3>
            <p className="mt-1 text-sm text-slate-600">
              {shift ? `Abierto · fondo ${formatMoney(shift.opening)} · esperado ${formatMoney(shift.expected)}` : 'Sin turno abierto'}
            </p>
          </div>
          <button type="button" className={secondary} disabled={loading} onClick={() => void run(readShift)}>Consultar turno</button>
        </div>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={changeShift}>
          <label className="text-xs font-semibold text-slate-700">
            {shift ? 'Efectivo contado (MXN)' : 'Fondo de apertura (MXN)'}
            <input className={field} inputMode="decimal" required value={shiftAmount} onChange={event => setShiftAmount(event.target.value)} placeholder="0.00" />
          </label>
          <button type="submit" className={submit} disabled={!ready || loading || Boolean(draft && cash && (!order || pending || order.state === 'review'))}>
            {shift ? 'Cerrar turno' : 'Abrir turno'}
          </button>
        </form>
        {closedShift && (
          <p className="mt-3 text-sm text-slate-700" role="status">
            Cierre registrado. Esperado {formatMoney(closedShift.expected)} · contado {formatMoney(closedShift.counted ?? 0)} · diferencia {formatMoney(closedShift.variance ?? 0)}.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Cobro y emisión de folios">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">{order ? 'Total de la orden' : 'Total estimado'}</h3>
            <p className="mt-1 text-2xl font-black text-slate-900">{subtotal} MXN</p>
          </div>
          {!draft && (
            <label className="text-xs font-semibold text-slate-700">
              Método de pago
              <select className={field} value={channel} onChange={event => setChannel(event.target.value as Channel)}>
                <option value="cash">Efectivo</option>
                <option value="terminal">Tarjeta · Stripe Terminal</option>
              </select>
            </label>
          )}
        </div>

        {message && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>}
        {!order && (
          <button type="button" disabled={!ready || loading || (!draft && !cart)} className={submit} onClick={prepare}>
            {draft ? 'Recuperar orden' : 'Preparar orden'}
          </button>
        )}
        {order && (
          <>
            <p role="status" className="text-sm text-slate-700">
              <strong>{expired ? 'Reserva vencida · verificar cobro' : orderLabels[order.state]}</strong> · {cash ? 'Efectivo' : 'Stripe Terminal'}
              <span className="block break-all text-xs text-slate-500">Orden {order.order_id}</span>
              {pending && <span className="block text-xs text-slate-500">Reserva hasta {new Date(order.expires_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Matamoros' })} (Matamoros)</span>}
            </p>
            {pending && cash && (
              <>
                <label className="block max-w-xs text-xs font-semibold text-slate-700">
                  Efectivo recibido (MXN)
                  <input className={field} value={tender} inputMode="decimal" disabled={loading || hasUnresolvedTender} onChange={event => setTender(event.target.value)} placeholder="0.00" />
                </label>
                {received !== null && received >= order.amount && <p className="text-sm text-slate-700">Cambio {formatMoney(received - order.amount)}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={loading || (!shift && !draft?.shiftId) || received === null || received < order.amount || (expired && !hasUnresolvedTender)} className={submit} onClick={confirmCash}>
                    {hasUnresolvedTender ? 'Reintentar la misma confirmación' : 'Confirmar efectivo recibido'}
                  </button>
                  <button type="button" disabled={loading || hasUnresolvedTender} className={secondary} onClick={cancelCash}>Cancelar orden</button>
                </div>
              </>
            )}
            {pending && !cash && (
              <>
                {readerLabel && <p className="text-sm text-slate-700">Estado de la terminal: {readerLabels[readerLabel] ?? readerLabel}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={loading || expired || reader.status === 'in_progress' || reader.status === 'failed'} className={submit} onClick={() => terminal('start')}>Enviar a la terminal</button>
                  {reader.status === 'failed' && reader.provider === 'requires_payment_method' && (
                    <button type="button" disabled={loading || expired} className={secondary} onClick={() => terminal('retry')}>Reintentar en la misma orden</button>
                  )}
                  <button type="button" disabled={loading} className={secondary} onClick={() => terminal('status')}>Consultar terminal</button>
                  <button type="button" disabled={loading} className={secondary} onClick={() => terminal('cancel')}>Cancelar cobro</button>
                </div>
              </>
            )}
            {(pending || order.state === 'review') && (
              <button type="button" className={secondary} disabled={loading} onClick={() => draft && void run(() => refreshOrder(draft))}>Consultar estado</button>
            )}
            {order.state === 'review' && <p className="text-sm text-amber-800">Comparte esta orden con la persona responsable de la conciliación antes de cobrar de nuevo.</p>}
            {order.state === 'issued' && (
              <button type="button" className={submit} disabled={loading} onClick={finish}>Ver recibo</button>
            )}
            {(order.state === 'closed' || order.state === 'voided') && (
              <button type="button" className={secondary} disabled={loading} onClick={finish}>Preparar otro cobro</button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

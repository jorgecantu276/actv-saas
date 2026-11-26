'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import RegistrationConsentFields from './RegistrationConsentFields';
import { consentFor, type RegistrationConsent, type RegistrationPolicy } from '../lib/registration-contract';

export type Cart = {
  eventId: string;
  relay: boolean;
  items: { athlete_id: string; package: 1 | 2; consent?: RegistrationConsent }[];
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

type SalesStatus = { paused: boolean; reason: string; can_manage: boolean; changed_at: string };
type RecoverableOrder = StaffOrder & {
  request_id: string; channel: Channel; cart: Cart;
  shift_id: string | null; received: number | null; reader_attempt: string | null;
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
  onReceipt: (order: StaffOrder, cart: Cart, method: Channel) => void | Promise<void>;
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
  const [sales, setSales] = useState<SalesStatus | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [recent, setRecent] = useState<RecoverableOrder[]>([]);
  const [recoveryId, setRecoveryId] = useState('');
  const busy = useRef(false);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [policyReady, setPolicyReady] = useState(false);
  const [acceptance, setAcceptance] = useState<Record<string, { notice: boolean; waiver: boolean }>>({});
  const cartEvent = cart?.eventId;
  const policyGeneration = useRef(0);
  const readPolicy = useCallback(async () => {
    const generation = ++policyGeneration.current;
    setPolicy(null); setPolicyReady(false); setAcceptance({});
    if (!cartEvent) return;
    const { data, error } = await supabase.rpc('actv_registration_policy', { p_event_id: cartEvent });
    if (generation !== policyGeneration.current) return;
    if (error) throw new Error('No se pudo consultar la información de inscripción. Actualiza antes de preparar la orden.');
    setPolicy(data as RegistrationPolicy); setPolicyReady(true);
  }, [cartEvent]);
  useEffect(() => {
    void readPolicy().catch(error => setMessage(error.message));
    return () => { policyGeneration.current++; };
  }, [readPolicy]);

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

  const readRecovery = useCallback(async () => {
    const status = await supabase.rpc('actv_sales_status');
    if (status.error) throw status.error;
    setSales(status.data as SalesStatus);
    const orders = await supabase.rpc('actv_staff_recent_orders', { p_limit: 30 });
    if (orders.error) throw orders.error;
    setRecent(orders.data as RecoverableOrder[]);
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
    void readRecovery().catch(() => {
      if (active) setMessage('No se pudo consultar la pausa de ventas y las órdenes del servidor. Consulta antes de preparar otro cobro.');
    });
    return () => { active = false; };
  }, [key, onLock, readShift, readRecovery]);

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
    await readRecovery();
    const { data, error } = await supabase.rpc('actv_sales_status');
    if (error) throw error;
    if ((data as SalesStatus).paused) throw new Error('Las ventas están pausadas. Puedes consultar órdenes y recibos existentes.');
    if (!cart) return;
    if (!policyReady) throw new Error('Consulta los requisitos de inscripción antes de preparar la orden.');
    if (cart.items.some(item => (policy?.notice_version && !acceptance[item.athlete_id]?.notice)
      || (policy?.waiver_version && !acceptance[item.athlete_id]?.waiver))) {
      throw new Error('Muestra los documentos y registra la aceptación de cada participante antes de preparar la orden.');
    }
    if (channel === 'cash' && !shift) throw new Error('Abre un turno de Caja para cobrar en efectivo.');
    const acceptedCart = { ...cart, items: cart.items.map(item => ({ ...item,
      ...(consentFor(policy, acceptance[item.athlete_id]?.notice ?? false, acceptance[item.athlete_id]?.waiver ?? false)
        ? { consent: consentFor(policy, acceptance[item.athlete_id]?.notice ?? false, acceptance[item.athlete_id]?.waiver ?? false) } : {}),
    })) };
    const attempt = { cart: acceptedCart, channel, requestId: crypto.randomUUID() };
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
    if (current.state === 'issued' && current.registrations?.length) await onReceipt(current, draft.cart, draft.channel);
    else if (current.state !== 'closed' && current.state !== 'voided') {
      storeDraft({ ...draft, order: current });
      setMessage('La orden no tiene folios vigentes para imprimir.');
      return;
    }
    storeDraft(null);
    setTender('');
    setReader({ status: null, provider: null });
    setMessage('');
    await readRecovery();
  });

  const recover = (id: string) => void run(async () => {
    if (draft) throw new Error('Resuelve la orden que está abierta antes de recuperar otra.');
    const { data, error } = await supabase.rpc('actv_staff_recover_order', { p_order_id: id.trim() });
    if (error) throw error;
    const recovered = data as RecoverableOrder;
    storeDraft({ cart: recovered.cart, channel: recovered.channel, requestId: recovered.request_id,
      order: readOrder(recovered), shiftId: recovered.shift_id ?? undefined,
      received: recovered.received ?? undefined, terminalTouched: recovered.channel === 'terminal',
      terminalRetry: recovered.reader_attempt && recovered.reader_attempt !== 'initial' ? recovered.reader_attempt : undefined });
    setTender(recovered.received === null ? '' : (recovered.received / 100).toFixed(2));
    setReader({ status: null, provider: null });
    setMessage(recovered.state === 'pending' && recovered.channel === 'cash'
      ? 'Orden recuperada sin pago confirmado. Verifica con el responsable si se recibió efectivo antes de confirmar; no cobres dos veces.'
      : 'Orden recuperada del servidor con su identidad y folios originales. Consulta su estado antes de repetir una operación.');
  });

  const changeSales = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      if (!sales?.can_manage) return;
      const { data, error } = await supabase.rpc('actv_set_sales_pause', {
        p_paused: !sales.paused, p_reason: pauseReason,
      });
      if (error) throw error;
      setSales(data as SalesStatus);
      setPauseReason('');
      setMessage('Cambio de ventas registrado. Las confirmaciones y los recibos existentes siguen disponibles.');
    });
  };

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
      <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Pausa y recuperación de ventas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">{sales ? (sales.paused ? 'Ventas pausadas' : 'Ventas habilitadas') : 'Consultar estado de ventas'}</h3>
            <p className="mt-1 text-sm text-slate-600">{sales?.reason ?? 'El servidor confirma si se pueden crear órdenes nuevas.'}</p>
          </div>
          <button type="button" className={secondary} disabled={loading} onClick={() => void run(readRecovery)}>Consultar ventas y órdenes</button>
        </div>
        {sales?.can_manage && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={changeSales}>
          <label className="text-xs font-semibold text-slate-700">Motivo operativo
            <input className={field} value={pauseReason} minLength={5} maxLength={500} required onChange={event => setPauseReason(event.target.value)} />
          </label>
          <button type="submit" className={secondary} disabled={loading}>{sales.paused ? 'Reanudar ventas' : 'Pausar ventas nuevas'}</button>
        </form>}
        <p className="mt-3 text-xs text-slate-600">Recupera una orden del servidor si se perdió la sesión local. La pausa conserva cobros aceptados, conciliación y folios.</p>
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); recover(recoveryId); }}>
          <input aria-label="Identificador de orden a recuperar" className={field} placeholder="Identificador de orden" value={recoveryId} onChange={event => setRecoveryId(event.target.value)} required />
          <button type="submit" className={secondary} disabled={loading || Boolean(draft)}>Recuperar por identificador</button>
        </form>
        {!!recent.length && <ul className="mt-3 space-y-2">{recent.map(item => <li key={item.order_id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <span className="break-all">{orderLabels[item.state]} · {formatMoney(item.amount)} · {item.channel === 'cash' ? 'Efectivo' : 'Terminal'} · {item.order_id}</span>
          <button type="button" className={secondary} disabled={loading || Boolean(draft)} onClick={() => recover(item.order_id)}>Recuperar</button>
        </li>)}</ul>}
      </section>
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
        {!draft && cart && <button type="button" disabled={loading} className={secondary} onClick={() => void run(readPolicy)}>Actualizar requisitos y documentos</button>}
        {!draft && cart && (policy?.notice_version || policy?.waiver_version) && <div className="space-y-3">{cart.items.map((item, index) => <section key={item.athlete_id}>
          <h4 className="mb-2 text-sm font-bold">Participante {index + 1}</h4>
          <RegistrationConsentFields policy={policy} staff notice={acceptance[item.athlete_id]?.notice ?? false} waiver={acceptance[item.athlete_id]?.waiver ?? false}
            onNotice={value => setAcceptance(previous => ({ ...previous, [item.athlete_id]: { notice: value, waiver: previous[item.athlete_id]?.waiver ?? false } }))}
            onWaiver={value => setAcceptance(previous => ({ ...previous, [item.athlete_id]: { waiver: value, notice: previous[item.athlete_id]?.notice ?? false } }))} />
        </section>)}</div>}
        {!order && (
          <button type="button" disabled={!ready || loading || (!draft && (!cart || !sales || sales.paused || !policyReady))} className={submit} onClick={prepare}>
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

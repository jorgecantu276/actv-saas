'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Banknote, ChevronLeft,
  ChevronRight, CreditCard, List, Search, ShieldAlert, Wallet, X,
} from 'lucide-react';
import { paymentFunction, PaymentsError } from '@/app/_pagos/api';
import { supabase } from '@/lib/supabase';
import styles from './AdminPayments.module.css';
import ParticipantRefunds from './ParticipantRefunds';

type Payment = {
  id: string;
  event_name: string;
  provider_payment_id: string | null;
  transaction_at: string;
  channel: string;
  provider?: 'stripe' | 'mercadopago' | 'cash';
  state: string;
  amount: number;
  captured: number | null;
  refunded: number;
  refund_status: string | null;
  application_fee_amount: number;
  folios: string[];
};
type Result = {
  liveMode: boolean;
  rows: Payment[];
  hasMore: boolean;
  totals: { captured: number; refunded: number; disputesLost: number };
};
type Movement = {
  id: string; kind: 'refund' | 'dispute' | 'payout'; amount: number; currency: string; state: string;
  recorded_at: string; order_id: string | null; label: string; channel: string | null;
};
type Outflows = { liveMode: boolean; rows: Movement[]; hasMore: boolean };
type Health = {
  observed_at: string;
  counts: { captured_without_eligible_folios: number; failed_payouts: number };
  webhooks: {
    pending: number; overdue: number; failed: number;
    examples: { event_id: string; type: string; received_at: string; attempts: number; failure_code: string | null }[];
  };
  refund_recovery: {
    pending: number; failed: number;
    examples: { id: string; order_id: string; requested_at: string; recovery_attempts: number; recovery_failure: string | null }[];
  };
  captured_without_eligible_folios: { order_id: string; captured_at: string; amount: number; currency: string }[];
  failed_payouts: { payout_id: string; recorded_at: string; amount: number; currency: string }[];
};
type Reason = 'requested_by_customer' | 'duplicate';
type Details = {
  refundRequest: {
    reason: Reason;
    requested_at: string;
    requested_by: string | null;
    refund_application_fee: boolean;
    provider_refund_id: string | null;
    status: string | null;
  } | null;
  adjustments: { id: string; kind: string; amount: number; status: string; date: string }[];
  provider: {
    type: string | null;
    brand: string | null;
    last4: string | null;
    country: string | null;
    funding: string | null;
    wallet: string | null;
    stripeFees: number | null;
    organizerNet: number | null;
    balanceCurrency: string | null;
    commission: number | null;
    canRefund: boolean;
  } | null;
};
type Filters = { from: string; to: string; search: string; channel: string; state: string };
type Selection = { payment: Payment; details: Details };

const channels: Record<string, string> = { online: 'Tarjeta en línea', terminal: 'Tarjeta en terminal', cash: 'Efectivo' };
const states: Record<string, string> = {
  pending: 'Pendiente', issued: 'Pagado', closed: 'Cerrado sin pago', review: 'En revisión', voided: 'Reembolsado',
};
const refundStates: Record<string, string> = {
  requested: 'Solicitud registrada', succeeded: 'Reembolso confirmado', pending: 'Pendiente',
  requires_action: 'Requiere acción en Stripe', failed: 'Reembolso fallido', canceled: 'Reembolso cancelado',
  needs_response: 'Requiere respuesta', under_review: 'En revisión', won: 'Ganado', lost: 'Perdido',
  paid: 'Pagado', in_transit: 'En tránsito',
};
const funding: Record<string, string> = { credit: 'Crédito', debit: 'Débito', prepaid: 'Prepago' };
const countries = new Intl.DisplayNames('es-MX', { type: 'region' });
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit' });
const timestamp = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Matamoros', dateStyle: 'medium', timeStyle: 'short',
});
const time = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Matamoros', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});
const amountText = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol' });
const formatMoney = (value: number) => amountText.format(value / 100);
function formatDate(value: string, formatter = timestamp) {
  const date = Date.parse(value);
  return Number.isFinite(date) ? formatter.format(date) : 'Sin fecha';
}

function Status({ value, label }: { value: string; label: string }) {
  const tone = ['issued', 'succeeded', 'paid', 'won'].includes(value) ? 'positive'
    : ['pending', 'review', 'requires_action', 'needs_response', 'in_transit'].includes(value) ? 'pending'
    : ['failed', 'lost', 'voided', 'canceled'].includes(value) ? 'negative' : 'neutral';
  return <span className={styles.status} data-tone={tone}>{label}</span>;
}

function Method({ channel, provider }: { channel: string; provider?: Payment['provider'] }) {
  const Icon = channel === 'cash' ? Banknote : CreditCard;
  return <span className={styles.method}><Icon size={15} strokeWidth={1.7} />{
    provider === 'mercadopago' ? 'Mercado Pago' : channels[channel] ?? channel
  }</span>;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentsError) {
    if (error.status === 401 || error.status === 403) return 'Tu sesión no tiene permiso para administrar pagos.';
    if (error.status === 400) return 'Revisa las fechas, los filtros o los datos de la solicitud.';
    if (error.status === 404) return 'No se encontró ese pago.';
    if (error.status === 409) return 'El pago cambió de estado. Consulta el detalle antes de intentar otra devolución.';
  }
  return 'No se pudo confirmar la operación. Consulta el detalle antes de volver a intentarla.';
}

const labelRefund = (status: string) => refundStates[status] ?? status;
const money = (value: number | null, currency: string) => value === null ? '—'
  : new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency.toUpperCase() }).format(value / 100);

export default function AdminPayments() {
  const [access, setAccess] = useState<'loading' | 'signed-out' | 'denied' | 'unavailable' | 'allowed'>('loading');
  const [account, setAccount] = useState('');
  useEffect(() => {
    let active = true;
    let userId: string | null = null;
    let initial = true;
    let inflight: AbortController | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!initial && userId === (session?.user.id ?? null)) return;
      initial = false;
      userId = session?.user.id ?? null;
      inflight?.abort();
      if (!session) {
        setAccount('');
        setAccess('signed-out');
        return;
      }
      setAccount('');
      setAccess('loading');
      const request = new AbortController();
      inflight = request;
      setTimeout(() => {
        if (!active || request.signal.aborted) return;
        void (async () => {
          try {
            const { data, error } = await supabase.rpc('actv_is_payment_manager').abortSignal(request.signal);
            if (!active || request.signal.aborted) return;
            if (error) { setAccess('unavailable'); return; }
            if (!data) { setAccess('denied'); return; }
            setAccount(session.user.id);
            setAccess('allowed');
          } catch {
            if (active && !request.signal.aborted) setAccess('unavailable');
          }
        })();
      }, 0);
    });
    return () => { active = false; inflight?.abort(); subscription.unsubscribe(); };
  }, []);

  if (access === 'allowed') return <PaymentsWorkspace key={account} />;
  return <main className={styles.accessPage}>
    <div className={styles.accessPanel}>
      <span className={styles.accessIcon}><Wallet size={22} /></span>
      <h1>Pagos</h1>
      <p role="status">{{
        loading: 'Verificando tu acceso…',
        'signed-out': 'Inicia sesión con tu cuenta de operaciones para abrir el espacio de pagos.',
        denied: 'Tu cuenta no tiene permisos de gestión de pagos.',
        unavailable: 'No pudimos comprobar tu acceso. Vuelve al punto de venta e inténtalo de nuevo.',
      }[access]}</p>
      {access !== 'loading' && <Link className={styles.primary} href="/">{access === 'signed-out' ? 'Iniciar sesión' : 'Volver al POS'}<ArrowRight size={16} /></Link>}
    </div>
  </main>;
}

function PaymentsWorkspace() {
  const [filters, setFilters] = useState<Filters>(() => ({
    from: day.format(new Date(Date.now() - 6 * 86400_000)), to: day.format(new Date()), search: '', channel: '', state: '',
  }));
  const [applied, setApplied] = useState(filters);
  const [result, setResult] = useState<Result | null>(null);
  const [outflows, setOutflows] = useState<Outflows | null>(null);
  const [view, setView] = useState<'list' | 'outflows' | 'health'>('list');
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    const signal = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const first = await paymentFunction<Result>('actv-admin-payments', { action: 'list', ...applied, offset: 0 }, signal.signal);
        if (active) setResult(first);
      } catch (failure) {
        if (active) setError(paymentError(failure));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; signal.abort(); };
    // Only the initial request uses this effect. Form submissions load their explicit filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      setError(paymentError(failure));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const load = async (nextFilters: Filters, nextOffset: number, nextView = view) => {
    if (nextView === 'health') return;
    const payload = { action: nextView, ...nextFilters, offset: nextOffset };
    if (nextView === 'outflows') setOutflows(await paymentFunction<Outflows>('actv-admin-payments', payload));
    else setResult(await paymentFunction<Result>('actv-admin-payments', payload));
    setApplied(nextFilters);
    setOffset(nextOffset);
  };

  const changeView = (nextView: typeof view) => run(async () => {
    await load(applied, 0, nextView);
    setSelection(null);
    setView(nextView);
  });

  const inspect = (payment: Payment) => run(async () => {
    const details = await paymentFunction<Details>('actv-admin-payments', { action: 'detail', orderId: payment.id });
    setSelection({ payment, details });
  });

  const showPage = (next: number) => run(async () => {
    await load(applied, next);
    setSelection(null);
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await load(filters, 0);
      setSelection(null);
    });
  };

  const sendRefund = (payment: Payment, reason: Reason, refundCommission: boolean) => run(async () => {
    const response = await paymentFunction<{ id: string; status: string }>('actv-admin-payments', {
      action: 'refund', orderId: payment.id, reason, refundCommission, confirmed: true,
    });
    setNotice(labelRefund(response.status) + ' · ' + response.id);
    await load(applied, offset);
    const details = await paymentFunction<Details>('actv-admin-payments', { action: 'detail', orderId: payment.id });
    setSelection({ payment: { ...payment, state: response.status === 'succeeded' ? 'voided' : payment.state }, details });
  });

  const activePage = view === 'list' ? result : outflows;
  const environment = result?.liveMode ?? outflows?.liveMode;
  const isList = view === 'list';
  const isHealth = view === 'health';
  return <main className={styles.workspace}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}><span /><span /><span /></span>
        <strong>ACTV</strong>
      </div>
      <nav className={styles.navigation} aria-label="Operaciones de pagos">
        <button type="button" aria-pressed={isList} disabled={loading}
          onClick={() => { if (!isList) void changeView('list'); }}>
          <List size={18} strokeWidth={1.7} />Pagos
        </button>
        <button type="button" aria-pressed={view === 'outflows'} disabled={loading}
          onClick={() => { if (view !== 'outflows') void changeView('outflows'); }}>
          <ArrowDownLeft size={18} strokeWidth={1.7} />Reembolsos y depósitos
        </button>
        <button type="button" aria-pressed={isHealth} disabled={loading || environment === undefined}
          onClick={() => { if (!isHealth) void changeView('health'); }}>
          <ShieldAlert size={18} strokeWidth={1.7} />Incidencias
        </button>
      </nav>
      <Link className={styles.back} href="/"><ArrowLeft size={17} strokeWidth={1.7} /> Volver al POS</Link>
    </aside>

    <section className={styles.main} aria-labelledby="admin-payment-title">
      <header className={styles.header}>
        <div>
          <h1 id="admin-payment-title">{isHealth ? 'Incidencias' : isList ? 'Pagos' : 'Reembolsos y depósitos'}</h1>
        </div>
        {environment !== undefined && <span className={styles.environment} data-test={!environment}>
          <span />{environment ? 'Producción' : 'Modo de prueba'}
        </span>}
      </header>

      {isHealth && environment !== undefined && <HealthPanel liveMode={environment} />}
      {!isHealth && <>
      {isList && result && <dl className={styles.ledger} aria-label="Totales del periodo">
        {([
          ['Total cobrado', result.totals.captured, ArrowUpRight],
          ['Total reembolsado', result.totals.refunded, ArrowDownLeft],
          ['Contracargos perdidos', result.totals.disputesLost, ShieldAlert],
        ] as const).map(([label, total, Icon], index) => <div key={label} className={styles.metric} data-primary={index === 0}>
          <dt>{label}<Icon size={18} strokeWidth={1.65} /></dt>
          <dd>{formatMoney(total)}<span>MXN</span></dd>
        </div>)}
      </dl>}

      <form className={styles.filter} data-view={view} onSubmit={submit}>
        {isList && <label className={styles.search}>
          <span>Buscar</span><span className={styles.controlWithIcon}><Search size={17} />
            <input maxLength={120} placeholder="Folio, carrera o referencia" value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </span>
        </label>}
        <label>Desde<input type="date" required value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Hasta<input type="date" required value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        {isList && <>
          <label>Método<select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
            <option value="">Todos</option>{Object.entries(channels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Estado<select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
            <option value="">Todos</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </>}
        <button className={styles.primary} type="submit" disabled={loading}>Buscar<ArrowRight size={16} /></button>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {!activePage && !error && <p className={styles.empty} role="status">Cargando movimientos…</p>}

      <div className={styles.activity} data-split={Boolean(selection)}>
        <div className={styles.register} aria-busy={loading}>
          {isList && result && <PaymentTable rows={result.rows} selected={selection?.payment.id} disabled={loading}
            onSelect={(payment) => void inspect(payment)} />}
          {!isList && outflows && <MovementTable rows={outflows.rows} />}
          {activePage && <footer className={styles.tableFooter}>
            <span>{activePage.rows.length ? `${offset + 1}–${offset + activePage.rows.length}` : '0 resultados'}</span>
            {(offset > 0 || activePage.hasMore) && <nav aria-label="Páginas de movimientos">
              <button type="button" className={styles.iconButton} disabled={loading || offset === 0}
                onClick={() => void showPage(offset - 25)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
              <button type="button" className={styles.iconButton} disabled={loading || !activePage.hasMore}
                onClick={() => void showPage(offset + 25)} aria-label="Página siguiente"><ChevronRight size={18} /></button>
            </nav>}
          </footer>}
        </div>
        {selection && <PaymentDetails key={selection.payment.id} selection={selection} loading={loading}
          close={() => setSelection(null)} sendRefund={sendRefund} />}
      </div>
      </>}
    </section>
  </main>;
}

function HealthPanel({ liveMode }: { liveMode: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const loadHealth = async () => {
      if (busy || controller.signal.aborted || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const { data, error } = await supabase.rpc('actv_payment_health', { p_live_mode: liveMode })
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        setError(Boolean(error || !data));
        if (!error && data) setHealth(data as Health);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        busy = false;
      }
    };
    void loadHealth();
    const interval = window.setInterval(() => void loadHealth(), 60_000);
    const onVisibility = () => void loadHealth();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [liveMode, refresh]);

  const groups = health ? [
    {
      name: 'Cobros sin folio', count: health.counts.captured_without_eligible_folios,
      guidance: 'Si el evento está lleno, revisa el pedido con el organizador.',
      rows: health.captured_without_eligible_folios.map((row) => ({
        id: row.order_id, label: `Pago de ${money(row.amount, row.currency)}`, date: row.captured_at,
      })),
    },
    {
      name: 'Avisos de Stripe atrasados', count: health.webhooks.overdue,
      guidance: 'Si el aviso sigue pendiente, comparte la referencia con soporte.',
      rows: health.webhooks.examples.map((row) => ({
        id: row.event_id, label: row.failure_code ? 'En reintento' : 'En espera de confirmación',
        detail: `${row.type} · ${row.attempts} intentos${row.failure_code ? ` · ${row.failure_code}` : ''}`,
        date: row.received_at,
      })),
    },
    {
      name: 'Reembolsos en seguimiento', count: health.refund_recovery.pending,
      guidance: 'Consulta el pago original antes de pedir otro reembolso.',
      rows: health.refund_recovery.examples.map((row) => ({
        id: row.id, label: 'Pendiente de confirmación', detail: `${row.recovery_attempts} intentos · Orden ${row.order_id}${row.recovery_failure ? ` · ${row.recovery_failure}` : ''}`,
        date: row.requested_at,
      })),
    },
    {
      name: 'Depósitos fallidos', count: health.counts.failed_payouts,
      guidance: 'Revisa la cuenta bancaria del organizador y el último depósito en Stripe.',
      rows: health.failed_payouts.map((row) => ({
        id: row.payout_id, label: `Depósito de ${money(row.amount, row.currency)}`, date: row.recorded_at,
      })),
    },
  ] : [];

  return <>
    <div className={styles.healthToolbar}>
      {health && <span>Actualizado {formatDate(health.observed_at)}</span>}
      <button type="button" className={styles.iconButton} onClick={() => setRefresh((value) => value + 1)}>Actualizar</button>
    </div>
    {error && <p className={styles.error} role="alert">No pudimos actualizar las incidencias.{health ? ' Mostramos la última consulta disponible.' : ''}</p>}
    {!health && !error && <p className={styles.empty} role="status">Consultando incidencias…</p>}
    {health && <>
      <dl className={`${styles.ledger} ${styles.healthLedger}`}>
        {groups.map((group) => <div className={styles.metric} key={group.name}>
          <dt>{group.name}</dt><dd>{group.count}</dd>
        </div>)}
      </dl>
      <div className={styles.healthGroups}>
        {groups.filter((group) => group.rows.length).map((group) => <section className={styles.register} key={group.name}>
          <h2 className={styles.tableTitle}>{group.name}</h2>
          <p className={styles.guidance}>{group.guidance}</p>
          <ul>{group.rows.map((row) => <li key={row.id}>
            <div><strong>{row.label}</strong>
              <details><summary>Ver referencia</summary><code>{row.id}</code>
                {'detail' in row && typeof row.detail === 'string' && <p>{row.detail}</p>}
              </details>
            </div>
            <time dateTime={row.date}>{formatDate(row.date, time)}</time>
          </li>)}</ul>
        </section>)}
        {groups.every((group) => group.rows.length === 0) && <p className={styles.empty}>Sin incidencias.</p>}
      </div>
    </>}
  </>;
}

function PaymentTable({ rows, selected, disabled, onSelect }: {
  rows: Payment[]; selected?: string; disabled: boolean; onSelect: (payment: Payment) => void;
}) {
  return <>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>
          <th scope="col">Pedido</th><th scope="col" className={styles.dateColumn}>Fecha</th>
          <th scope="col" className={styles.methodColumn}>Método de pago</th><th scope="col">Estado</th>
          <th scope="col" className={styles.number}>Importe</th><th scope="col"><span className="sr-only">Detalle</span></th>
        </tr></thead>
        <tbody>{rows.map((payment) => <tr key={payment.id} data-selected={selected === payment.id}>
          <td>
            <strong className={styles.event}>{payment.event_name}</strong>
            <span className={styles.reference}>{payment.folios.length ? `Folio ${payment.folios.join(', ')}` : payment.id.slice(0, 8)}</span>
          </td>
          <td className={styles.dateColumn}>{formatDate(payment.transaction_at, time)}</td>
          <td className={styles.methodColumn}><Method channel={payment.channel} provider={payment.provider} /></td>
          <td>
            <Status value={payment.state} label={states[payment.state] ?? payment.state} />
            {payment.refund_status && payment.state !== 'voided' && <span className={styles.reference}>{labelRefund(payment.refund_status)}</span>}
          </td>
          <td className={styles.number}>
            <strong>{formatMoney(payment.captured ?? payment.amount)}</strong>
            {payment.refunded > 0 && <span className={styles.reference}>−{formatMoney(payment.refunded)}</span>}
          </td>
          <td><button type="button" className={styles.rowAction} aria-label={`Ver detalle ${payment.id}`}
            aria-expanded={selected === payment.id} disabled={disabled} onClick={() => onSelect(payment)}><ChevronRight size={19} /></button></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className={styles.empty}>Sin pagos para estos filtros.</p>}
    </div>
  </>;
}

function MovementTable({ rows }: { rows: Movement[] }) {
  const kinds = { payout: 'Depósito bancario', refund: 'Reembolso', dispute: 'Contracargo' };
  return <>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th scope="col">Movimiento</th><th scope="col" className={styles.dateColumn}>Fecha de registro</th>
          <th scope="col">Estado</th><th scope="col" className={styles.number}>Importe</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.kind}:${row.id}`}>
          <td><strong className={styles.event}>{kinds[row.kind]}</strong>
            <span className={styles.reference}>{row.label}</span>
            <details className={styles.reference}><summary>Ver referencia</summary><code>{row.id}</code></details>
          </td>
          <td className={styles.dateColumn}>{formatDate(row.recorded_at, time)}</td>
          <td><Status value={row.state} label={labelRefund(row.state)} /></td>
          <td className={styles.number}><strong>{money(row.amount, row.currency)}</strong></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className={styles.empty}>Sin movimientos en el periodo.</p>}
    </div>
  </>;
}

function PaymentDetails({ selection, loading, close, sendRefund }: {
  selection: Selection; loading: boolean; close: () => void;
  sendRefund: (payment: Payment, reason: Reason, refundCommission: boolean) => Promise<void>;
}) {
  const { payment, details } = selection;
  const panel = useRef<HTMLElement>(null);
  const { provider, refundRequest } = details;
  const hasRefundId = Boolean(refundRequest?.provider_refund_id);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<Reason>(refundRequest?.reason ?? 'requested_by_customer');
  const [commission, setCommission] = useState(refundRequest?.refund_application_fee ?? true);
  const [understood, setUnderstood] = useState(false);
  const canRequest = Boolean(provider && (provider.canRefund || refundRequest) && !hasRefundId);
  const cardCountry = provider?.country && /^[A-Z]{2}$/.test(provider.country) ? countries.of(provider.country) : null;
  const cardDescription = [provider?.brand, provider?.last4 && `•••• ${provider.last4}`,
    provider?.funding && funding[provider.funding], cardCountry, provider?.wallet].filter(Boolean).join(' · ');

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 1100px)').matches) panel.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  return <section ref={panel} tabIndex={-1} aria-label="Detalle del pago" className={styles.detail}>
    <header className={styles.detailHeader}>
      <h2>Detalle del pago</h2>
      <button className={styles.iconButton} type="button" disabled={loading} onClick={close} aria-label="Cerrar detalle"><X size={18} /></button>
    </header>
    <div className={styles.detailHero}>
      <Status value={payment.state} label={states[payment.state] ?? payment.state} />
      <p className={styles.detailAmount}>{money(payment.captured ?? payment.amount, 'MXN')}</p>
      <strong>{payment.event_name}</strong>
      <small>{formatDate(payment.transaction_at)}</small>
    </div>
    <dl className={styles.detailFacts}>
      <div><dt>Método de pago</dt><dd><Method channel={payment.channel} provider={payment.provider} />
        {cardDescription && <small>{cardDescription}</small>}</dd></div>
      {payment.folios.length > 0 && <div><dt>Folios</dt><dd>{payment.folios.join(', ')}</dd></div>}
      {provider && <div><dt>Comisión de ACTV</dt><dd>{money(provider.commission, 'MXN')}</dd></div>}
      {provider && <div><dt>Comisión de Stripe e impuestos</dt><dd>{money(provider.stripeFees, provider.balanceCurrency ?? 'MXN')}</dd></div>}
      {provider && <div><dt>Importe neto del pago</dt><dd>{money(provider.organizerNet, provider.balanceCurrency ?? 'MXN')}</dd></div>}
    </dl>
    {payment.provider === 'mercadopago' && payment.captured !== null && <p className={styles.audit}>
      Consulta comisiones y haz reembolsos en Mercado Pago.
    </p>}
    <details className={styles.detailId}><summary>Ver referencia del pago</summary>
      <code>{payment.provider_payment_id ?? payment.id}</code>
    </details>
    {details.adjustments.length > 0 && <ul className={styles.adjustments}>
      {details.adjustments.map((item) => <li key={item.id}>
        <strong>{item.kind === 'refund' ? 'Reembolso' : 'Contracargo'} {formatMoney(item.amount)}</strong>
        <Status value={item.status} label={labelRefund(item.status)} />
        <small>{formatDate(item.date)}</small><code>{item.id}</code>
      </li>)}
    </ul>}
    {refundRequest && <p className={styles.audit}>
      Solicitud del {formatDate(refundRequest.requested_at)}
      {refundRequest.requested_by && ` por ${refundRequest.requested_by}`}.
      {' '}{refundRequest.refund_application_fee ? 'Incluye la devolución de la comisión de ACTV.' : 'Conserva la comisión de ACTV.'}
    </p>}
    <ParticipantRefunds orderId={payment.id} />
    {canRequest && !confirming && <button type="button" className={styles.refundAction} disabled={loading} onClick={() => setConfirming(true)}>
      <ArrowDownLeft size={17} />{refundRequest ? 'Revisar reembolso' : 'Reembolsar pago'}
    </button>}
    {canRequest && confirming && <form className={styles.refundForm} onSubmit={(event) => {
      event.preventDefault();
      if (understood) void sendRefund(payment, reason, commission);
    }}>
      <h3>Reembolsar {money(payment.captured ?? payment.amount, 'MXN')}</h3>
      <p>Se devuelve a la tarjeta original. Al confirmarse, {payment.folios.length === 1 ? `se anulará el folio ${payment.folios[0]}.` :
        payment.folios.length > 1 ? `se anularán los folios ${payment.folios.join(', ')}.` :
          'se anularán los folios de este pedido.'}</p>
      <label>Motivo<select value={reason} disabled={loading || Boolean(refundRequest)} onChange={(e) => setReason(e.target.value as Reason)}>
        <option value="requested_by_customer">Solicitado por el participante</option><option value="duplicate">Cobro duplicado</option>
      </select></label>
      <label className={styles.check}><input type="checkbox" checked={commission} disabled={loading || Boolean(refundRequest)} onChange={(e) => setCommission(e.target.checked)} />Devolver al organizador la comisión de ACTV{provider?.commission ? ` (${formatMoney(provider.commission)})` : ''}</label>
      <label className={styles.check}><input type="checkbox" checked={understood} disabled={loading} onChange={(e) => setUnderstood(e.target.checked)} />Confirmo el reembolso de este pago</label>
      <div className={styles.confirmActions}>
        <button className={styles.danger} type="submit" disabled={loading || !understood}>{loading ? 'Procesando…' : 'Confirmar reembolso'}</button>
        <button className={styles.iconButton} type="button" disabled={loading} onClick={() => { setUnderstood(false); setConfirming(false); }}>Volver</button>
      </div>
    </form>}
  </section>;
}

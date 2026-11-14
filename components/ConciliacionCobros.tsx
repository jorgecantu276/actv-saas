'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { centavos, formatMoney } from './CajaCobros';

type ChannelTotal = { channel: string; live_mode: boolean; orders: number; captured: number; adjustments: number; net: number };
type PaymentException = { order_id: string; state: string; channel: string; live_mode: boolean; amount: number };
type Shift = {
  id: string;
  state: string;
  expected: number;
  counted: number | null;
  variance: number | null;
  deposit_expected: number | null;
  deposit_amount: number | null;
  deposit_reference: string | null;
  deposit_variance: number | null;
};
type Settlement = {
  payout_id: string;
  account_id: string;
  live_mode: boolean;
  state: string;
  amount: number;
  currency: string;
  lines_total: number | null;
  variance: number | null;
  unmatched_charge_lines: number;
  bank_reference: string | null;
  bank_amount: number | null;
  bank_variance: number | null;
};
type Reconciliation = {
  channels: ChannelTotal[];
  shifts: Shift[];
  settlements: Settlement[];
  exceptions: PaymentException[];
  webhooks?: { live_mode: boolean; pending: number; failed: number; oldest: string }[];
};
type Target = { shift: Shift } | { payout: Settlement };

const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const action = 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-45';
const dayInMexico = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit',
}).format();
const channels: Record<string, string> = { cash: 'Efectivo', terminal: 'Terminal', online: 'En línea', stripe_checkout: 'En línea' };
const states: Record<string, string> = {
  pending: 'Pendiente', issued: 'Emitido', closed: 'Cerrado', open: 'Abierto', review: 'Por revisar',
  voided: 'Anulado', paid: 'Pagado', failed: 'Fallido', canceled: 'Cancelado', in_transit: 'En tránsito',
};
const liveMode = (live: boolean) => live ? 'Producción' : 'Prueba';
const amount = (value: number | null | undefined, currency = 'mxn') =>
  value == null ? '—' : currency.toLowerCase() === 'mxn'
    ? formatMoney(value)
    : new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(value / 100);

function Table({ title, columns, rows }: { title: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50">
            <tr>{columns.map(column => <th scope="col" className="whitespace-nowrap px-3 py-2" key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-200">
                {row.map((cell, column) => <td key={column} className="whitespace-nowrap px-3 py-2">{cell}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={columns.length} className="px-3 py-3 text-slate-500">Sin registros en el período.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ConciliacionCobros({ canMatch }: { canMatch: boolean }) {
  const [from, setFrom] = useState(dayInMexico);
  const [to, setTo] = useState(dayInMexico);
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [reportDates, setReportDates] = useState({ from: '', to: '' });
  const [target, setTarget] = useState<Target | null>(null);
  const [reference, setReference] = useState('');
  const [bankAmount, setBankAmount] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const load = async (start: string, end: string) => {
    const { data, error } = await supabase.rpc('actv_reconciliation', { p_from: start, p_to: end });
    if (error) throw error;
    setResult(data as Reconciliation);
    setReportDates({ from: start, to: end });
  };

  const run = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      setError((failure as { message?: string })?.message || 'No se pudo completar la conciliación.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const editMatch = (record: Target) => {
    setTarget(record);
    const value = 'shift' in record ? record.shift.deposit_amount : record.payout.bank_amount;
    setBankAmount(value == null ? '' : (value / 100).toFixed(2));
    setReference(('shift' in record ? record.shift.deposit_reference : record.payout.bank_reference) ?? '');
  };

  const recordMatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const parsed = centavos(bankAmount);
      if (!target || parsed === null || !reference.trim()) throw new Error('Captura la referencia y el importe exacto del movimiento bancario.');
      const { error } = 'shift' in target
        ? await supabase.rpc('actv_match_cash_deposit', { p_shift_id: target.shift.id, p_reference: reference.trim(), p_amount: parsed })
        : await supabase.rpc('actv_match_bank', {
          p_account_id: target.payout.account_id,
          p_live_mode: target.payout.live_mode,
          p_payout_id: target.payout.payout_id,
          p_reference: reference.trim(),
          p_amount: parsed,
        });
      if (error) throw error;
      setTarget(null);
      setNotice('Movimiento bancario registrado. La diferencia permanece visible para su revisión.');
      await load(reportDates.from, reportDates.to);
    });
  };

  const matchButton = (record: Target, label: string) => (
    <button type="button" className="font-bold text-blue-800 underline disabled:opacity-45" onClick={() => editMatch(record)} disabled={loading}>{label}</button>
  );

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 no-print" aria-label="Conciliación de cobros">
      <h2 className="text-lg font-black text-slate-900">Conciliación de cobros</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        setTarget(null);
        void run(() => load(from, to));
      }}>
        <label className="grid gap-1 text-xs font-bold text-slate-700">Desde<input className={control} type="date" value={from} onChange={event => setFrom(event.target.value)} required /></label>
        <label className="grid gap-1 text-xs font-bold text-slate-700">Hasta<input className={control} type="date" value={to} min={from} onChange={event => setTo(event.target.value)} required /></label>
        <button type="submit" className={action} disabled={loading}>Consultar</button>
      </form>
      {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      {target && (
        <form className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={recordMatch}>
          <p className="break-all text-sm font-semibold text-slate-900">
            {'shift' in target ? `Depósito de caja · ${target.shift.id}` : `Depósito Stripe · ${target.payout.payout_id}${target.payout.live_mode ? '' : ' · prueba'}`}
          </p>
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Referencia bancaria
            <input className={control} value={reference} maxLength={200} onChange={event => setReference(event.target.value)} required />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Importe recibido ({'shift' in target ? 'MXN' : target.payout.currency.toUpperCase()})
            <input className={control} value={bankAmount} inputMode="decimal" onChange={event => setBankAmount(event.target.value)} required />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={action} disabled={loading}>Registrar movimiento</button>
            <button type="button" className={control} disabled={loading} onClick={() => setTarget(null)}>Cancelar</button>
          </div>
        </form>
      )}
      {result && (
        <>
          <p className="text-xs text-slate-500">Período consultado {reportDates.from} a {reportDates.to}</p>
          <Table title="Cobros por canal" columns={['Canal', 'Modo', 'Órdenes', 'Capturado', 'Ajustes', 'Neto']} rows={(result.channels ?? []).map(row => [
            channels[row.channel] ?? row.channel, row.channel === 'cash' ? 'Caja' : liveMode(row.live_mode), row.orders, amount(row.captured), amount(row.adjustments), amount(row.net),
          ])} />
          <Table title="Órdenes por revisar" columns={['Orden', 'Estado', 'Canal', 'Modo', 'Importe']} rows={(result.exceptions ?? []).map(row => [
            row.order_id, states[row.state] ?? row.state, channels[row.channel] ?? row.channel, row.channel === 'cash' ? 'Caja' : liveMode(row.live_mode), amount(row.amount),
          ])} />
          <Table title="Webhooks por procesar" columns={['Modo', 'Pendientes', 'Con error', 'Más antiguo']} rows={(result.webhooks ?? []).map(row => [
            liveMode(row.live_mode), row.pending, row.failed, new Date(row.oldest).toLocaleString('es-MX'),
          ])} />
          <Table title="Turnos y depósitos de caja" columns={['Turno', 'Estado', 'Esperado', 'Contado', 'Diferencia', 'Depósito esperado', 'Referencia bancaria', 'Depositado', 'Diferencia bancaria', 'Registro']} rows={(result.shifts ?? []).map(row => [
            row.id, states[row.state] ?? row.state, amount(row.expected), amount(row.counted), amount(row.variance), amount(row.deposit_expected),
            row.deposit_reference ?? '—', amount(row.deposit_amount), amount(row.deposit_variance),
            canMatch && row.state === 'closed' && !row.deposit_reference ? matchButton({ shift: row }, 'Registrar') : '—',
          ])} />
          <Table title="Liquidaciones Stripe y depósitos" columns={['Liquidación', 'Modo', 'Estado', 'Importe', 'Detalle', 'Diferencia', 'Cargos sin orden', 'Referencia bancaria', 'Depositado', 'Diferencia bancaria', 'Registro']} rows={(result.settlements ?? []).map(row => [
            row.payout_id, liveMode(row.live_mode), states[row.state] ?? row.state, amount(row.amount, row.currency),
            amount(row.lines_total, row.currency), amount(row.variance, row.currency), row.unmatched_charge_lines, row.bank_reference ?? '—', amount(row.bank_amount, row.currency),
            amount(row.bank_variance, row.currency), canMatch && row.state === 'paid' && !row.bank_reference ? matchButton({ payout: row }, 'Registrar') : '—',
          ])} />
        </>
      )}
    </section>
  );
}

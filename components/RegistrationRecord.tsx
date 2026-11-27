'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { participantFields, type ParticipantData, type RegistrationRecordData } from '../lib/registration-contract';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm';
type Props = { registrationId: string; onChanged?: () => void };
export default function RegistrationRecord(props: Props) {
  return <RegistrationRecordBody key={props.registrationId} {...props} />;
}
function RegistrationRecordBody({ registrationId, onChanged }: {
  registrationId: string; onChanged?: () => void;
}) {
  const [record, setRecord] = useState<RegistrationRecordData | null>(null);
  const [form, setForm] = useState<ParticipantData>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ p_registration_id: string; p_expected_revision: number;
    p_request_id: string; p_patch: ParticipantData; p_reason: string } | null>(null);
  const [pendingVisible, setPendingVisible] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    const { data, error } = await supabase.rpc('actv_registration_record', { p_registration_id: registrationId });
    if (current !== generation.current) return;
    if (error) { setRecord(null); throw new Error(error.message); }
    setRecord(data as RegistrationRecordData);
    setForm((data as RegistrationRecordData).effective.participant);
  }, [registrationId]);
  useEffect(() => {
    const current = ++generation.current;
    void supabase.rpc('actv_registration_record', { p_registration_id: registrationId }).then(({ data, error }) => {
      if (generation.current !== current) return;
      if (error) { setRecord(null); setMessage(error.message); }
      else { setRecord(data as RegistrationRecordData); setForm((data as RegistrationRecordData).effective.participant); }
    });
    return () => { generation.current = current + 1; };
  }, [registrationId]);

  const save = async () => {
    if (!record || busy) return;
    setBusy(true); setMessage('');
    try {
      if (!pending.current) {
        const patch = Object.fromEntries(participantFields.filter(([key]) =>
          (form[key] ?? '') !== (record.effective.participant[key] ?? '')).map(([key]) => [key, form[key]?.trim() || null]));
        if (!Object.keys(patch).length) throw new Error('No hay cambios que registrar.');
        pending.current = { p_registration_id: registrationId, p_expected_revision: record.revision,
          p_request_id: crypto.randomUUID(), p_patch: patch, p_reason: reason.trim() };
        setPendingVisible(true);
      }
      const { error } = await supabase.rpc('actv_correct_registration', pending.current);
      if (error) {
        // A database rejection rolls back this request. Unknown transport outcomes
        // retain the same identity/payload until the operator can recover them.
        if (error.code && /^(22|23|42501|P000)/.test(error.code)) { pending.current = null; setPendingVisible(false); }
        throw new Error(error.message);
      }
      pending.current = null; setPendingVisible(false); setEditing(false); setReason('');
      await load(); onChanged?.(); setMessage('Corrección registrada. Se conservan la inscripción, el pago y el folio originales.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se confirmó la corrección; reintenta la misma solicitud.'); }
    finally { setBusy(false); }
  };

  return <section aria-label="Datos e historial de inscripción" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold">Datos de esta inscripción</h3>
      <button type="button" disabled={busy || pendingVisible} className="rounded border px-3 py-2 text-sm" onClick={() => void load().catch(error => setMessage(error.message))}>Actualizar</button>
    </div>
    {message && <p role="status" className="rounded bg-amber-50 p-3 text-sm">{message}</p>}
    {!record && !message && <p role="status">Consultando inscripción…</p>}
    {record && <>
      <p className="text-sm">Revisión {record.revision} · {record.provenance === 'accepted_order' ? 'Datos conservados al aceptar la orden' : 'Datos retenidos; aceptación histórica incompleta o desconocida'}</p>
      <dl className="grid gap-3 sm:grid-cols-2">{participantFields.map(([key, label]) => <div key={key}><dt className="text-xs text-slate-500">{label}</dt><dd>{record.effective.participant[key] || 'No registrado'}</dd></div>)}</dl>
      <p className="text-sm">Paquete: {record.effective.package?.name ?? 'No registrado'} · Evento: {record.effective.event?.name ?? record.event_id}</p>
      <p className="text-sm">Consentimiento: {record.original?.consent?.status === 'accepted' ? 'Aceptación registrada con la versión presentada' : 'Sin evidencia de aceptación registrada'}</p>
      {record.can_correct && !editing && <button type="button" className="rounded bg-slate-900 px-4 py-2 text-white" onClick={() => setEditing(true)}>Corregir datos con motivo</button>}
      {record.can_correct && editing && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
        <p className="text-sm">Una corrección ajusta datos de esta inscripción. El historial conserva sus valores originales.</p>
        <fieldset disabled={busy || pendingVisible} className="grid gap-3 sm:grid-cols-2">{participantFields.map(([key, label, type, max]) => <label key={key} className="text-sm">{label}<input className={inputClass} type={type} maxLength={max} value={form[key] ?? ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</fieldset>
        <label className="block text-sm">Motivo de la corrección<textarea className={inputClass} required minLength={5} maxLength={500} disabled={busy || pendingVisible} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">{pendingVisible ? 'Consultar y reintentar la misma corrección' : 'Guardar corrección'}</button><button type="button" disabled={busy || pendingVisible} className="rounded border px-4 py-2" onClick={() => { setEditing(false); setForm(record.effective.participant); }}>Cancelar</button></div>
      </form>}
      <details><summary className="cursor-pointer font-semibold">Valores aceptados originalmente</summary>{record.original ? <div className="mt-3 space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2">{participantFields.map(([key, label]) => <div key={key}><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm">{record.original?.participant?.[key] || 'Desconocido'}</dd></div>)}</dl>
        <p className="text-sm">Paquete: {record.original.package?.name ?? 'Desconocido'} · Fecha del evento: {record.original.event?.date ?? 'Desconocida'}</p>
        <p className="text-sm">Aceptación registrada: {record.original.accepted_at ? new Date(record.original.accepted_at).toLocaleString('es-MX') : 'Sin fecha conocida'}</p>
        <p className="text-sm">Aviso: {record.original.consent?.notice_version ?? 'Sin versión aceptada conocida'} · Condiciones: {record.original.consent?.waiver_version ?? 'Sin versión aceptada conocida'}</p>
      </div> : <p className="text-sm">Desconocidos. Los datos observados al incorporar el registro no prueban una aceptación anterior.</p>}</details>
      <details><summary className="cursor-pointer font-semibold">Historial de correcciones ({record.corrections.length})</summary>{record.corrections.map(change => <article key={change.request_id} className="mt-3 border-t py-3 text-sm"><p>Revisión {change.revision} · {change.reason}</p><p className="break-all text-xs">{new Date(change.happened_at).toLocaleString('es-MX')} · Responsable: {change.actor}</p>
        <dl className="mt-2 space-y-2">{participantFields.filter(([key]) => change.before.participant[key] !== change.after.participant[key]).map(([key, label]) => <div key={key}><dt className="font-semibold">{label}</dt><dd>{change.before.participant[key] || 'No registrado'} → {change.after.participant[key] || 'No registrado'}</dd></div>)}</dl>
      </article>)}</details>
    </>}
  </section>;
}

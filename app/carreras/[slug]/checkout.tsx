'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formattedPrice, goToStripe, orderStatusPath, paymentFunction, PaymentsError, type PackageNumber, type Race, type StartedOrder } from '../../_pagos/api';
import { PaymentAlert, PaymentPage, paymentButton, paymentInput, secondaryButton } from '../../_pagos/ui';

type Participant = {
  nombre: string;
  apellido: string;
  telefono: string;
  telefono_emergencia: string;
  talla_playera: string;
  package: PackageNumber;
};

type ParticipantForm = Participant & { rowId: string };

const newParticipant = (option: PackageNumber): ParticipantForm => ({
  rowId: crypto.randomUUID(), package: option, nombre: '', apellido: '', telefono: '',
  telefono_emergencia: '', talla_playera: '',
});

const fields = [
  ['nombre', 'Nombre', 'text'], ['apellido', 'Apellido', 'text'],
  ['telefono', 'Teléfono', 'tel'], ['telefono_emergencia', 'Teléfono de emergencia', 'tel'],
] as const;

function formatEventDate(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return date;
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' }).format(timestamp);
}

export default function Checkout({ slug }: { slug: string }) {
  const [race, setRace] = useState<Race | null>(null);
  const [participants, setParticipants] = useState<ParticipantForm[]>([]);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const paymentInProgress = useRef(false);

  useEffect(() => {
    const request = new AbortController();
    paymentFunction<{ event: Race }>('actv-checkout', { action: 'event', slug }, request.signal)
      .then(({ event }) => {
        if (request.signal.aborted) return;
        setRace(event);
        setParticipants(event.options.length ? [newParticipant(event.options[0].id)] : []);
        setError('');
      })
      .catch((cause: unknown) => {
        if (request.signal.aborted) return;
        setError(cause instanceof PaymentsError && cause.status === 404
          ? 'Esta carrera no tiene inscripciones en línea disponibles.'
          : 'No pudimos cargar la carrera. Intenta de nuevo.');
      })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [slug, reload]);

  function updateParticipant(rowId: string, change: Partial<Participant>) {
    setParticipants((current) => current.map((item) => item.rowId === rowId ? { ...item, ...change } : item));
  }

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!race || paymentInProgress.current) return;
    const payload = {
      eventId: race.id,
      buyerEmail: buyerEmail.trim().toLowerCase(),
      participants: participants.map(({ nombre, apellido, telefono, telefono_emergencia, talla_playera, package: selectedPackage }) => ({
        nombre: nombre.trim(), apellido: apellido.trim(), telefono: telefono.trim(),
        telefono_emergencia: telefono_emergencia.trim(), talla_playera, package: selectedPackage,
      })),
    };
    if (payload.participants.some(({ nombre, apellido, telefono, telefono_emergencia }) =>
      !nombre || !apellido || telefono.length < 7 || telefono_emergencia.length < 7)) {
      setError('Completa el nombre, apellido y los teléfonos de cada participante.');
      return;
    }
    const payloadKey = JSON.stringify(payload);
    if (attempt.current?.payload !== payloadKey) attempt.current = { payload: payloadKey, key: crypto.randomUUID() };
    paymentInProgress.current = true;
    setSubmitting(true);
    setError('');
    try {
      const order = await paymentFunction<StartedOrder>('actv-checkout', {
        action: 'start', ...payload, idempotencyKey: attempt.current.key,
      });
      if (order.checkoutUrl) goToStripe(order.checkoutUrl, 'checkout');
      else window.location.assign(orderStatusPath(order.orderId, order.orderToken));
    } catch (cause) {
      const status = cause instanceof PaymentsError ? cause.status : 0;
      const message = status === 409 ? 'La disponibilidad cambió. Verifica los paquetes e intenta de nuevo.'
        : status === 400 ? 'Revisa los datos de contacto y de los participantes.'
          : 'No se pudo iniciar el pago. Intenta de nuevo con los mismos datos.';
      setError(message);
      paymentInProgress.current = false;
      setSubmitting(false);
    }
  }

  const maxParticipants = Math.min(race?.limits?.maxParticipants ?? 20, race?.available ?? Infinity);
  const total = participants.reduce((amount, row) =>
    amount + (race?.options.find((option) => option.id === row.package)?.amountMinor ?? 0), 0);

  return (
    <PaymentPage label="Inscripción en línea" title={race?.name ?? 'Inscripción a la carrera'}>
      {loading && <p role="status" className="mt-5 text-slate-600">Cargando la carrera…</p>}
      {!race && error && (
        <>
          <PaymentAlert>{error}</PaymentAlert>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={() => { setLoading(true); setReload((n) => n + 1); }}>Volver a cargar</button>
        </>
      )}
      {race && (
        <>
          {race.date && <p className="mt-3 text-slate-700">{formatEventDate(race.date)}</p>}
          {race.description && <p className="mt-3 max-w-2xl whitespace-pre-line text-slate-700">{race.description}</p>}
          {race.options.length === 0 || maxParticipants <= 0 ? (
            <p className="mt-7 rounded-xl bg-white p-5">No hay lugares disponibles para inscripción en línea.</p>
          ) : (
            <form onSubmit={startCheckout} className="mt-8 space-y-5">
              <fieldset disabled={submitting} className="space-y-5">
                <label className="block rounded-xl border border-slate-200 bg-white p-5 text-sm font-semibold">
                  Correo de contacto para el pedido
                  <input autoComplete="email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={paymentInput} required maxLength={250} />
                </label>
                {participants.map((participant, index) => (
                  <section key={participant.rowId} className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-sans text-lg font-bold">Participante {index + 1}</h2>
                      {participants.length > 1 && (
                        <button type="button" aria-label={`Quitar participante ${index + 1}`} className="text-sm font-medium text-blue-800 underline" onClick={() => setParticipants((rows) => rows.filter((row) => row.rowId !== participant.rowId))}>Quitar</button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {fields.map(([field, label, type]) => (
                        <label key={field} className="text-sm font-semibold">{label}
                          <input minLength={type === 'tel' ? 7 : 1} maxLength={type === 'tel' ? 30 : 100} className={paymentInput} type={type} required value={participant[field]} onChange={(e) => updateParticipant(participant.rowId, { [field]: e.target.value })} />
                        </label>
                      ))}
                      <label className="text-sm font-semibold">Paquete
                        <select aria-label="Paquete" className={paymentInput} value={participant.package} onChange={(e) => updateParticipant(participant.rowId, { package: Number(e.target.value) as PackageNumber })}>
                          {race.options.map(({ id, name, amountMinor, currency }) => <option key={id} value={id}>{name} · {formattedPrice(amountMinor, currency)}</option>)}
                        </select>
                      </label>
                      <label className="text-sm font-semibold">Talla de playera
                        <select aria-label="Talla de playera" className={paymentInput} required value={participant.talla_playera} onChange={(e) => updateParticipant(participant.rowId, { talla_playera: e.target.value })}>
                          <option value="">Selecciona una talla</option>
                          {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => <option key={size}>{size}</option>)}
                        </select>
                      </label>
                    </div>
                  </section>
                ))}
                {participants.length < maxParticipants && <button type="button" className={secondaryButton} onClick={() => setParticipants((rows) => [...rows, newParticipant(race.options[0].id)])}>Agregar participante</button>}
              </fieldset>
              {error && <PaymentAlert>{error}</PaymentAlert>}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-5 text-white">
                <p>{participants.length} {participants.length === 1 ? 'inscripción' : 'inscripciones'}
                  <span className="ml-3 font-semibold">{formattedPrice(total, race.options[0].currency)}</span>
                </p>
                <button type="submit" className={paymentButton} disabled={submitting}>{submitting ? 'Abriendo Stripe…' : 'Continuar a Stripe'}</button>
              </div>
            </form>
          )}
        </>
      )}
    </PaymentPage>
  );
}

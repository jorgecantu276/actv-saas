'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { formattedPrice, goToCheckout, orderStatusPath, paymentFunction, PaymentsError, providerLabels, type OnlineProvider, type PackageNumber, type Race, type StartedOrder } from '../../_pagos/api';
import { PublicSite, raceDate } from '../../_pagos/public-site';
import { RacePhoto } from '../../_pagos/race-art';
import styles from '../../_pagos/race-journey.module.css';

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

export default function Checkout({ slug }: { slug: string }) {
  const [race, setRace] = useState<Race | null>(null);
  const [participants, setParticipants] = useState<ParticipantForm[]>([]);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [provider, setProvider] = useState<OnlineProvider>('stripe');
  const [lockedProvider, setLockedProvider] = useState<OnlineProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ payload: string; key: string; provider: OnlineProvider } | null>(null);
  const paymentInProgress = useRef(false);

  useEffect(() => {
    const request = new AbortController();
    paymentFunction<{ event: Race }>('actv-checkout', { action: 'event', slug }, request.signal)
      .then(({ event }) => {
        if (request.signal.aborted) return;
        setRace(event);
        setProvider(event.paymentProviders?.[0] ?? 'stripe');
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
    if (!attempt.current) attempt.current = { payload: payloadKey, key: crypto.randomUUID(), provider };
    if (attempt.current.payload !== payloadKey || attempt.current.provider !== provider) return;
    setLockedProvider(provider);
    paymentInProgress.current = true;
    setSubmitting(true);
    setError('');
    try {
      const order = await paymentFunction<StartedOrder>('actv-checkout', {
        action: 'start', ...payload, provider, idempotencyKey: attempt.current.key,
      });
      if (order.provider === 'mercadopago') {
        try { sessionStorage.setItem(`actv:payment:${order.orderId}`, order.orderToken); } catch { /* Webhook remains independent. */ }
      }
      if (order.checkoutUrl) goToCheckout(order.checkoutUrl, order.provider ?? provider);
      else window.location.assign(orderStatusPath(order.orderId, order.orderToken));
    } catch (cause) {
      const status = cause instanceof PaymentsError ? cause.status : 0;
      if (status === 400) {
        attempt.current = null;
        setLockedProvider(null);
      }
      const message = status === 409 ? 'La disponibilidad cambió. Verifica los paquetes e intenta de nuevo.'
        : status === 400 ? 'Revisa los datos de contacto y de los participantes.'
          : 'No se pudo abrir el pago. Vuelve a intentar con el mismo método.';
      setError(message);
      paymentInProgress.current = false;
      setSubmitting(false);
    }
  }

  const maxParticipants = Math.min(race?.limits?.maxParticipants ?? 20, race?.available ?? Infinity);
  const providers = race?.paymentProviders ?? ['stripe' as const];
  const total = participants.reduce((amount, row) =>
    amount + (race?.options.find((option) => option.id === row.package)?.amountMinor ?? 0), 0);

  return (
    <PublicSite active="/carreras">
      <div className={styles.section}>
      <Link className={styles.back} href="/carreras"><ArrowLeft size={16} aria-hidden="true" /> Calendario</Link>
      <header className={styles.heading}>
        <p className={styles.kicker}>Inscripción</p>
        <h1>{race?.name ?? 'Inscripción a la carrera'}</h1>
        {race?.date && <p className={styles.raceMeta}><time dateTime={race.date}>{raceDate(race.date)}</time></p>}
        {race?.description && <p className={styles.description}>{race.description}</p>}
      </header>
      {loading && <p role="status" className={styles.notice}>Cargando la carrera…</p>}
      {!race && error && (
        <>
          <p role="alert" className={styles.error}>{error}</p>
          <button type="button" className={styles.outline} onClick={() => { setLoading(true); setReload((n) => n + 1); }}>Volver a cargar</button>
        </>
      )}
      {race && (
        <>
          {race.options.length === 0 || maxParticipants <= 0 || providers.length === 0 ? (
            <p className={styles.notice}>No hay lugares disponibles para inscripción en línea.</p>
          ) : (
            <form onSubmit={startCheckout} className={styles.layout}>
              <fieldset disabled={submitting || lockedProvider !== null} className={styles.fields}>
                <label className={styles.emailField}>
                  Correo de contacto para el pedido
                  <input autoComplete="email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={styles.input} required maxLength={250} />
                </label>
                {participants.map((participant, index) => (
                  <section key={participant.rowId} className={styles.participant}>
                    <div className={styles.participantHeader}>
                      <h2>Participante {index + 1}</h2>
                      {participants.length > 1 && (
                        <button type="button" aria-label={`Quitar participante ${index + 1}`} className={styles.textButton} onClick={() => setParticipants((rows) => rows.filter((row) => row.rowId !== participant.rowId))}>Quitar</button>
                      )}
                    </div>
                    <div className={styles.fieldGrid}>
                      {fields.map(([field, label, type]) => (
                        <label key={field} className={styles.field}>{label}
                          <input minLength={type === 'tel' ? 7 : 1} maxLength={type === 'tel' ? 30 : 100} className={styles.input} type={type} required value={participant[field]} onChange={(e) => updateParticipant(participant.rowId, { [field]: e.target.value })} />
                        </label>
                      ))}
                      <label className={styles.field}>Paquete
                        <select className={styles.input} value={participant.package} onChange={(e) => updateParticipant(participant.rowId, { package: Number(e.target.value) as PackageNumber })}>
                          {race.options.map(({ id, name, amountMinor, currency }) => <option key={id} value={id}>{name} · {formattedPrice(amountMinor, currency)}</option>)}
                        </select>
                      </label>
                      <label className={styles.field}>Talla de playera
                        <select className={styles.input} required value={participant.talla_playera} onChange={(e) => updateParticipant(participant.rowId, { talla_playera: e.target.value })}>
                          <option value="">Selecciona una talla</option>
                          {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => <option key={size}>{size}</option>)}
                        </select>
                      </label>
                    </div>
                  </section>
                ))}
                {participants.length < maxParticipants && (
                  <button type="button" className={`${styles.outline} ${styles.add}`} onClick={() => setParticipants((rows) => [...rows, newParticipant(race.options[0].id)])}>
                    Agregar participante <Plus size={15} aria-hidden="true" />
                  </button>
                )}
              </fieldset>
              <aside className={styles.summary} aria-labelledby="order-summary">
                <RacePhoto className={styles.summaryPhoto} sizes="(max-width: 760px) 90vw, 390px" />
                <div className={styles.summaryBody}>
                  <div className={styles.summaryTitle}>
                    <h2 id="order-summary">Tu inscripción</h2>
                    <span>{participants.length} {participants.length === 1 ? 'participante' : 'participantes'}</span>
                  </div>
                  <p className={styles.total} aria-live="polite">
                    <span>Total</span> <strong>{formattedPrice(total, race.options[0].currency)} {race.options[0].currency.toUpperCase()}</strong>
                  </p>
                  {providers.length > 1 && <fieldset disabled={submitting || lockedProvider !== null} className={styles.providers}>
                    <legend>Pagar con</legend>
                    {providers.map((value) => <label key={value}>
                      <input type="radio" name="provider" value={value} checked={provider === value} onChange={() => setProvider(value)} />
                      {providerLabels[value]}
                    </label>)}
                  </fieldset>}
                  {error && <p role="alert" className={styles.error}>{error}</p>}
                  <button type="submit" className={styles.action} disabled={submitting}>
                    {submitting ? 'Abriendo pago…' : `Continuar a ${providerLabels[provider]}`} <ArrowRight size={19} aria-hidden="true" />
                  </button>
                </div>
              </aside>
            </form>
          )}
        </>
      )}
      </div>
    </PublicSite>
  );
}

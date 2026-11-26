'use client';

import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, ArrowUpRight, LogOut, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccountEntry } from '@/app/_pagos/account-entry';
import { supabase } from '@/lib/supabase';
import { goToStripe, paymentFunction, PaymentsError } from '../_pagos/api';
import { PublicSite } from '../_pagos/public-site';
import { PaymentAlert } from '../_pagos/ui';
import styles from './organizers.module.css';

const { primaryButton, outlineButton, paymentInput } = styles;

type ConnectionState = {
  accountId?: string | null;
  onboardingUrl?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  onlineEnabled?: boolean;
  ready?: boolean;
  slug?: string | null;
  eventName?: string;
};

const isEventUuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const validRaceSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const raceDateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' });
const dateInputFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit',
});
const invalidOrganizerName = 'Escribe un nombre de organizador de 3 a 100 caracteres.';

type OrganizerEvent = { event_id: string; name: string; slug: string | null; date: string };
type EventDetail = {
  account_id: string | null;
  event_name: string;
  online_enabled: boolean;
  ready: boolean;
  slug: string;
  date: string;
  distance: string | null;
  capacity: number;
  live_mode: boolean;
};
type OrganizerHomeData = {
  organizer_id: string | null;
  organizer_name: string | null;
  events: OrganizerEvent[];
};

function raceSlug(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-/, '').slice(0, 80).replace(/-$/, '');
}

function organizerHomeError(message: string, code: string | undefined) {
  if (code === '23505') return 'Esa dirección ya pertenece a otra carrera.';
  if (code === '42501') return 'Tu cuenta no tiene permiso para realizar este cambio.';
  return message;
}

function OrganizerHome() {
  const router = useRouter();
  const createIdentity = useRef<string>('');
  useEffect(() => { createIdentity.current = crypto.randomUUID(); }, []);
  const [profile, setProfile] = useState<OrganizerHomeData | null>(null);
  const [organizerName, setOrganizerName] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const earliestRaceDate = dateInputFormat.format(new Date());
  const raceDateLimit = new Date(earliestRaceDate + 'T00:00:00Z');
  raceDateLimit.setUTCDate(raceDateLimit.getUTCDate() + 3650);
  const latestRaceDate = raceDateLimit.toISOString().slice(0, 10);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data, error } = await supabase.rpc('actv_organizer_events').abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error || !data) {
          setProfile(null);
          setError('No se pudieron cargar tus eventos.');
          return;
        }
        setProfile(data as OrganizerHomeData);
      } catch {
        if (!controller.signal.aborted) {
          setProfile(null);
          setError('No se pudieron cargar tus eventos.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [refresh]);

  function reload() {
    setError('');
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = organizerName.trim();
    if (name.length < 3 || name.length > 100) {
      setError(invalidOrganizerName);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('actv_organizer_signup', { p_name: name });
      if (error || !data) {
        if (error?.code === '42501') setError('Confirma tu correo para continuar.');
        else if (error?.code === '22023') setError(invalidOrganizerName);
        else setError('No se pudo guardar el perfil de organizador.');
        return;
      }
      setNotice('Tu perfil de organizador está listo.');
      reload();
    } catch {
      setError('No se pudo guardar el perfil de organizador.');
    } finally {
      setBusy(false);
    }
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = eventName.trim();
    const slug = (eventSlug ?? raceSlug(name)).trim();
    const date = String(form.get('date'));
    const priceText = String(form.get('price'));
    const price = Math.round(Number(priceText) * 100);
    const capacity = Number(form.get('capacity'));
    const distance = String(form.get('distance') ?? '').trim();
    if (name.length < 3 || name.length > 100) {
      setError('Escribe un nombre de evento de 3 a 100 caracteres.');
      return;
    }
    if (isEventUuid(slug) || !validRaceSlug.test(slug) || slug.length < 2 || slug.length > 80) {
      setError('Usa de 2 a 80 caracteres en la dirección, con letras minúsculas, números y guiones.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < earliestRaceDate || date > latestRaceDate) {
      setError('Selecciona una fecha entre hoy y los próximos diez años.');
      return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || price < 1600 || price > 10_000_000) {
      setError('El precio por persona debe estar entre $16 y $100,000 MXN.');
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20_000) {
      setError('El cupo debe estar entre 1 y 20,000 personas.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('actv_operations_save_event', {
        p_event_id: createIdentity.current,
        p_values: { name, date, slug, price: price / 100, capacity,
          distance: distance || 'Por confirmar', package_name: 'Individual',
          live_mode: form.get('mode') === 'live', online_enabled: false, folio_start: 1 },
      });
      const eventId = (data as OrganizerEvent | null)?.event_id;
      if (error || !eventId || !isEventUuid(eventId)) {
        setError(organizerHomeError('No se pudo crear el evento. Revisa la fecha y los datos.', error?.code));
        return;
      }
      router.push('/operaciones?evento=' + encodeURIComponent(eventId));
    } catch {
      setError('No se pudo crear el evento. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.workspace} aria-busy={loading}>
      {loading && <p role="status">Cargando tus carreras…</p>}
      {error && (
        <>
          <PaymentAlert>{error}</PaymentAlert>
          {!profile && <button type="button" className={outlineButton} onClick={reload}>Reintentar</button>}
        </>
      )}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {profile && !profile.organizer_id && (
        <section className={styles.signup} aria-labelledby="organizer-profile-title">
          <form onSubmit={signup} className={styles.fields}>
            <div>
              <h2 id="organizer-profile-title" className={styles.heading}>Configura tu perfil</h2>
              <p className={styles.muted}>Este nombre aparecerá en las carreras que organices.</p>
            </div>
            <label>Nombre del equipo, club u organizador
              <input className={paymentInput} autoComplete="organization" value={organizerName} minLength={3} maxLength={100}
                onChange={(event) => setOrganizerName(event.target.value)} required disabled={busy || loading} />
            </label>
            <button type="submit" className={primaryButton} disabled={busy || loading}>
              {busy ? 'Guardando…' : 'Crear perfil y continuar'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
      {profile?.organizer_id && (
        <div className={styles.homeGrid}>
          <section aria-labelledby="organizer-events-title" className={styles.list}>
            <div className={styles.listHeading}>
              <div>
                <h2 id="organizer-events-title" className={styles.heading}>Mis carreras</h2>
                {profile.organizer_name && <p className={styles.muted}>{profile.organizer_name}</p>}
              </div>
              <a href="#nueva-carrera" className={outlineButton}><Plus size={15} aria-hidden /> Nueva carrera</a>
            </div>
            {profile.events.length === 0 ? (
              <p className={styles.empty}>Todavía no has creado carreras.</p>
            ) : (
              <ul className={styles.races} role="list">
                {profile.events.map((race) => (
                  <li key={race.event_id}>
                    <Link href={'/organizadores?evento=' + encodeURIComponent(race.event_id)} className={styles.race}>
                      <time dateTime={race.date}>{raceDateFormat.format(new Date(race.date + 'T12:00:00Z'))}</time>
                      <span>{race.name}</span>
                      <ArrowUpRight size={17} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <form onSubmit={createEvent} className={styles.createForm + ' ' + styles.fields} id="nueva-carrera">
            <div>
              <h2 className={styles.heading}>{profile.events.length ? 'Nueva carrera' : 'Crea tu primera carrera'}</h2>
              <p className={styles.muted}>Guarda el borrador antes de abrir las inscripciones.</p>
            </div>
            <label>Nombre de la carrera
              <input className={paymentInput} value={eventName} onChange={(event) => setEventName(event.target.value)}
                minLength={3} maxLength={100} required disabled={busy || loading} />
            </label>
            <div className={styles.fieldGrid}>
              <label>Fecha del evento
                <input className={paymentInput} name="date" type="date" min={earliestRaceDate} max={latestRaceDate} required disabled={busy || loading} />
              </label>
              <label>Distancia (opcional)
                <input className={paymentInput} name="distance" placeholder="Ej. 5 km" maxLength={45} disabled={busy || loading} />
              </label>
              <label>Precio por folio (MXN)
                <input className={paymentInput} name="price" type="number" min="16" max="100000" step="0.01"
                  inputMode="decimal" required disabled={busy || loading} />
              </label>
              <label>Cupo de personas
                <input className={paymentInput} name="capacity" type="number" min="1" max="20000" step="1"
                  inputMode="numeric" required disabled={busy || loading} />
              </label>
            </div>
            <label>Entorno de cobro
              <select className={paymentInput} name="mode" defaultValue="" required disabled={busy || loading}>
                <option value="" disabled>Selecciona el entorno</option><option value="test">Pruebas</option><option value="live">Real</option>
              </select>
            </label>
            <details className={styles.address}>
              <summary>Editar dirección de inscripción</summary>
              <label>Enlace público de la carrera
                <input className={paymentInput} value={eventSlug ?? raceSlug(eventName)}
                  onChange={(event) => setEventSlug(event.target.value)} placeholder="mi-carrera"
                  autoCapitalize="none" spellCheck={false} minLength={2} maxLength={80} disabled={busy || loading}
                  aria-describedby="race-link-hint" />
                <span id="race-link-hint" className={styles.muted}>/carreras/{eventSlug || raceSlug(eventName) || 'mi-carrera'}</span>
              </label>
            </details>
            <button type="submit" className={primaryButton} disabled={busy || loading}>
              <Plus size={17} aria-hidden="true" />{busy ? 'Guardando…' : 'Crear borrador'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function Organizers({ initialEventId, shouldResume, linkFailed }: {
  initialEventId: string;
  shouldResume: boolean;
  linkFailed?: boolean;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const eventId = initialEventId;
  const [slug, setSlug] = useState('');
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const viewingEvent = isEventUuid(initialEventId);
  const returnPath = viewingEvent
    ? `/organizadores?evento=${encodeURIComponent(initialEventId)}${shouldResume ? '&reanudar=1' : ''}`
    : '/organizadores';

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id || !isEventUuid(initialEventId)) return;
    const controller = new AbortController();
    async function load() {
      try {
        const { data, error } = await supabase.rpc('actv_organizer_event_detail', { p_event_id: initialEventId }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error || !data) {
          setDetailError(error?.code === '42501' ? 'Tu cuenta no tiene acceso a esta carrera.' : 'No se pudo cargar esta carrera.');
          return;
        }
        const result = data as EventDetail;
        setDetail(result);
        setConnection({
          accountId: result.account_id, ready: result.ready,
          onlineEnabled: result.online_enabled, slug: result.slug, eventName: result.event_name,
        });
        setOnlineEnabled(result.online_enabled);
        setSlug(result.slug);
        setDetailError('');
      } catch {
        if (controller.signal.aborted) return;
        setDetailError('No se pudo cargar esta carrera.');
      }
    }
    void load();
    return () => controller.abort();
  }, [detailRefresh, initialEventId, session?.user.id]);

  function organizerError(cause: unknown) {
    return cause instanceof PaymentsError && (cause.status === 403 || cause.status === 404)
      ? 'Tu cuenta no tiene acceso a este evento o el evento no existe.'
      : 'No se pudo actualizar la información. Intenta de nuevo.';
  }

  async function signOut() {
    setSigningOut(true);
    setError('');
    setNotice('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setSession(null);
      setConnection(null);
      setDetail(null);
      setDetailError('');
      setOnlineEnabled(false);
      setSlug('');
    } catch {
      setError('No se pudo cerrar la sesión. Intenta de nuevo.');
    } finally {
      setSigningOut(false);
    }
  }

  async function stripeAction(action: 'status' | 'onboard') {
    if (!isEventUuid(eventId.trim())) { setError('Escribe el ID del evento.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await paymentFunction<ConnectionState>('actv-organizer-connect', { action, eventId: eventId.trim() });
      if (action === 'onboard' && result.onboardingUrl) goToStripe(result.onboardingUrl, 'onboarding');
      setConnection(result);
      setOnlineEnabled(result.onlineEnabled ?? false);
      setSlug(result.slug ?? '');
    } catch (cause) {
      setError(organizerError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedEventId = eventId.trim();
    if (!isEventUuid(selectedEventId)) { setError('Escribe el ID del evento.'); return; }
    if (onlineEnabled && !ready) { setError('Completa la conexión con Stripe antes de abrir las inscripciones.'); return; }
    const name = slug.trim() === selectedEventId ? '' : slug.trim();
    if (name && (isEventUuid(name) || !validRaceSlug.test(name))) { setError('Usa letras minúsculas, números y guiones en la dirección.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: configError } = await supabase.rpc('actv_configure_event', {
        p_event_id: selectedEventId, p_online_enabled: onlineEnabled,
        ...(name ? { p_slug: name } : {}),
      });
      if (configError) {
        setError(configError.code === '23505' ? 'Esa dirección ya pertenece a otra carrera.'
          : 'No pudimos guardar el evento. Revisa tus permisos y la conexión con Stripe.');
      } else {
        setConnection((current) => ({
          ...current, onlineEnabled: data?.online_enabled ?? onlineEnabled, slug: data?.slug ?? (name || current?.slug),
          ready: data?.ready ?? current?.ready, eventName: data?.event_name ?? current?.eventName,
        }));
        setNotice(onlineEnabled ? 'Inscripciones en línea publicadas.' : 'Inscripciones en línea pausadas.');
      }
    } catch {
      setError('No pudimos guardar el evento. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  const ready = connection?.ready ?? Boolean(connection?.chargesEnabled && connection.payoutsEnabled);

  if (session === null) return <AccountEntry audience="organizer" returnPath={returnPath} linkFailed={linkFailed} />;

  return (
    <PublicSite active="/organizadores">
      <div className={styles.page}>
        {session === undefined && <p role="status">Cargando tu sesión…</p>}
        {session && (
          <>
            <header className={styles.header}>
              <div className={styles.topline}>
                {viewingEvent
                  ? <Link href="/organizadores"><ArrowLeft size={15} aria-hidden /> Mis carreras</Link>
                  : <span>{session.user.email}</span>}
                <button type="button" className={styles.signOut} onClick={() => void signOut()} disabled={busy || signingOut}>
                  <LogOut size={15} aria-hidden /> {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
                </button>
              </div>
              <h1 className={styles.title}>{viewingEvent ? (connection?.eventName || 'Carrera') : 'Organizadores'}</h1>
              {detail && (
                <p className={styles.raceMeta}>
                  <time dateTime={detail.date}>{raceDateFormat.format(new Date(detail.date + 'T12:00:00Z'))}</time>
                  {detail.distance && detail.distance !== 'Por confirmar' && <span>{detail.distance}</span>}
                  <span>Cupo: {detail.capacity}</span>
                  <strong>{connection?.onlineEnabled ? 'Inscripciones abiertas' : 'Inscripciones cerradas'}</strong>
                  {!detail.live_mode && <span>Modo de prueba</span>}
                </p>
              )}
            </header>
            {error && <div className={styles.notice}><PaymentAlert>{error}</PaymentAlert></div>}
            {!viewingEvent && <OrganizerHome key={session.user.id} />}
            {viewingEvent && !detail && (detailError
              ? <div className={styles.notice}>
                <p role="alert">{detailError}</p>
                <button type="button" className={outlineButton} onClick={() => { setDetailError(''); setDetailRefresh((current) => current + 1); }}>Reintentar</button>
              </div>
              : <p className={styles.notice} role="status">Cargando la carrera…</p>)}
            {viewingEvent && detail && (
              <>
                <nav className={styles.sections} aria-label="Secciones de la carrera">
                  <Link href={`/operaciones?evento=${eventId}`}>Operar carrera</Link>
                  <a href="#inscripcion-en-linea">Inscripción en línea</a>
                </nav>
                <div className={styles.notice}><Link className={primaryButton} href={`/operaciones?evento=${eventId}`}>Abrir inscripciones, kits y asistencia</Link></div>
                <section id="inscripcion-en-linea" className={styles.settings} aria-labelledby="checkout-title">
                  <h2 id="checkout-title" className={styles.heading}>Inscripción en línea</h2>
                  <div className={styles.settingsGrid}>
                  <section className={styles.fields} aria-labelledby="stripe-title">
                    <h3 id="stripe-title">Cobros con Stripe</h3>
                    {shouldResume && !ready && <p className={styles.muted}>Continúa en Stripe para renovar el enlace de registro.</p>}
                    {connection && (
                      <p className={styles.muted} role="status">
                        {ready ? 'La cuenta puede cobrar y recibir depósitos.' : 'Conecta una cuenta para abrir las inscripciones.'}
                      </p>
                    )}
                    <div className={styles.actions}>
                      {!ready && <button type="button" className={primaryButton} disabled={busy || signingOut} onClick={() => stripeAction('onboard')}>
                        {connection?.accountId ? 'Continuar en Stripe' : 'Conectar Stripe'} <ArrowUpRight size={16} aria-hidden="true" />
                      </button>}
                      <button type="button" className={outlineButton} disabled={busy || signingOut} onClick={() => stripeAction('status')}>Consultar conexión</button>
                    </div>
                  </section>
                  <form onSubmit={publish} className={styles.fields}>
                    <h3>Página de inscripción</h3>
                    <label>Enlace público de la carrera
                      <input disabled={busy || signingOut} value={slug} onChange={(event) => setSlug(event.target.value)} className={paymentInput} autoCapitalize="none" maxLength={80} spellCheck={false} placeholder="mi-carrera" />
                    </label>
                    <label className={styles.checkbox}>
                      <input disabled={busy || signingOut || (!ready && !onlineEnabled)} type="checkbox" checked={onlineEnabled} onChange={(event) => setOnlineEnabled(event.target.checked)} />
                      Habilitar ventas en línea
                    </label>
                    <div className={styles.actions}>
                      <button type="submit" className={primaryButton} disabled={busy || signingOut}>Guardar inscripción en línea</button>
                      {connection?.onlineEnabled && <Link className={styles.textLink} href={`/carreras/${encodeURIComponent(connection.slug || eventId.trim())}`}>
                        Ver página de inscripción <ArrowUpRight size={15} aria-hidden="true" />
                      </Link>}
                    </div>
                  </form>
                  </div>
                  {notice && <p className={styles.notice} role="status">{notice}</p>}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </PublicSite>
  );
}

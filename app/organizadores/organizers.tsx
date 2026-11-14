'use client';

import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { goToStripe, paymentFunction, PaymentsError } from '../_pagos/api';
import { PaymentAlert, PaymentPage, paymentButton, paymentInput, secondaryButton } from '../_pagos/ui';

type ConnectionState = {
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

export default function Organizers({ initialEventId, shouldResume }: { initialEventId: string; shouldResume: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState(initialEventId);
  const [slug, setSlug] = useState('');
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id || eventId !== initialEventId || !isEventUuid(initialEventId)) return;
    const controller = new AbortController();
    paymentFunction<ConnectionState>('actv-organizer-connect', { action: 'status', eventId: initialEventId }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setConnection(result);
        setOnlineEnabled(result.onlineEnabled ?? false);
        setSlug(result.slug ?? '');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(organizerError(cause));
      });
    return () => controller.abort();
  }, [initialEventId, eventId, session?.user.id]);

  function organizerError(cause: unknown) {
    return cause instanceof PaymentsError && (cause.status === 403 || cause.status === 404)
      ? 'Tu cuenta no tiene acceso a este evento o el evento no existe.'
      : 'No se pudo actualizar la información. Intenta de nuevo.';
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError('No pudimos iniciar sesión. Revisa tu correo y contraseña.');
      else setPassword('');
    } catch {
      setError('No pudimos iniciar sesión. Intenta de nuevo.');
    } finally {
      setBusy(false);
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
    const name = slug.trim();
    if (name && !validRaceSlug.test(name)) { setError('Usa letras minúsculas, números y guiones en la dirección.'); return; }
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

  return (
    <PaymentPage label="Organizadores" title="Cobros de tus carreras">
      {session === undefined && <p role="status" className="mt-5">Cargando sesión…</p>}
      {session === null && (
        <form onSubmit={signIn} className="mt-6 max-w-md space-y-4 rounded-xl bg-white p-5 sm:p-7">
          <p className="text-sm text-slate-700">Inicia sesión con la cuenta asignada por ACTV.</p>
          <label className="block text-sm font-semibold">Correo electrónico
            <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className={paymentInput} />
          </label>
          <label className="block text-sm font-semibold">Contraseña
            <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={paymentInput} />
          </label>
          <button type="submit" className={paymentButton} disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
        </form>
      )}
      {session && (
        <>
          <div className="mt-4 flex items-center justify-between gap-4 text-sm text-slate-600">
            <span>{session.user.email}</span>
            <button type="button" className="font-semibold text-blue-800 underline" onClick={async () => {
              const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
              if (signOutError) setError('No se pudo cerrar la sesión.');
              else { setConnection(null); setNotice(''); setError(''); }
            }}>Cerrar sesión</button>
          </div>
          {shouldResume && <p className="mt-4 text-sm text-slate-700">Continúa en Stripe para renovar el enlace de registro.</p>}
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="font-sans text-xl font-bold">Cuenta de Stripe</h2>
            <label className="mt-4 block text-sm font-semibold">ID del evento
              <input disabled={busy} value={eventId} onChange={(event) => { setEventId(event.target.value); setConnection(null); setOnlineEnabled(false); setSlug(''); setNotice(''); setError(''); }} className={paymentInput} autoCapitalize="none" maxLength={36} spellCheck={false} />
            </label>
            {connection?.eventName && <p className="mt-3 text-sm font-semibold">{connection.eventName}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {!ready && <button type="button" className={paymentButton} disabled={busy || !isEventUuid(eventId.trim())} onClick={() => stripeAction('onboard')}>Conectar con Stripe</button>}
              <button type="button" className={secondaryButton} disabled={busy || !isEventUuid(eventId.trim())} onClick={() => stripeAction('status')}>Consultar conexión</button>
            </div>
            {connection && <p className="mt-4 text-sm" role="status">{ready ? 'Cuenta habilitada para cobrar y recibir depósitos.' : 'La cuenta aún no está lista para cobrar y recibir depósitos.'}</p>}
          </section>
          <form onSubmit={publish} className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="font-sans text-xl font-bold">Inscripción en línea</h2>
            <label className="block text-sm font-semibold">Dirección pública de la carrera
              <input disabled={busy} value={slug} onChange={(event) => setSlug(event.target.value)} className={paymentInput} autoCapitalize="none" maxLength={80} spellCheck={false} placeholder="mi-carrera" />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input disabled={busy} type="checkbox" checked={onlineEnabled} onChange={(event) => setOnlineEnabled(event.target.checked)} className="h-4 w-4 accent-blue-700" />
              Habilitar ventas en línea
            </label>
            <button type="submit" className={paymentButton} disabled={busy || !isEventUuid(eventId.trim())}>Guardar inscripción en línea</button>
            {connection?.onlineEnabled && <Link className="block text-sm font-semibold text-blue-800 underline" href={`/carreras/${encodeURIComponent(connection.slug || eventId.trim())}`}>Ver página de inscripción</Link>}
          </form>
        </>
      )}
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p>}
      {error && <PaymentAlert>{error}</PaymentAlert>}
    </PaymentPage>
  );
}

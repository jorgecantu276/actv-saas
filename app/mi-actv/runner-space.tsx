'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, Check, CheckCircle2, Clipboard,
  Flag, LogOut, RefreshCw, Share2, UserCheck,
} from 'lucide-react';
import { AccountEntry } from '@/app/_pagos/account-entry';
import { supabase } from '@/lib/supabase';
import { attendanceMilestones, runnerHistory, type Registration } from './runner-history';
import { actvDisplay } from '@/app/_pagos/public-type';
import styles from './runner-space.module.css';

type RunnerDashboard = { registrations: Registration[] };

const raceDate = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const localDay = new Intl.DateTimeFormat('sv-SE', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Matamoros',
});
function achievementPath(slug: string) {
  return /^[A-Za-z0-9_-]{1,200}$/.test(slug) ? '/logros/' + encodeURIComponent(slug) : null;
}

export default function RunnerSpace() {
  const [session, setSession] = useState<Session | null>();
  const [linkFailed, setLinkFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const failed = url.searchParams.has('error_code') || fragment.has('error_code');
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, current) => {
      setSession(current);
      if (event === 'INITIAL_SESSION') setLinkFailed(failed && !current);
      if (current) setLinkFailed(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    setSigningOut(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setSession(null);
    } catch {
      setMessage('No pudimos cerrar tu sesión. Inténtalo de nuevo.');
    } finally {
      setSigningOut(false);
    }
  }

  if (session === null) return <AccountEntry audience="runner" returnPath="/mi-actv" linkFailed={linkFailed} />;

  return <div className={actvDisplay.variable + ' ' + styles.site}>
    <header className={styles.header}>
      <div className={styles.shell}>
        <Link href="/inicio" className={styles.brand} aria-label="Inicio de ACTV">ACTV</Link>
        <nav aria-label="Mi ACTV">
          <Link href="/carreras" className={styles.racesLink}>Ver carreras <ArrowUpRight size={15} aria-hidden="true" /></Link>
          {session && <button type="button" className={styles.signOut} disabled={signingOut} onClick={() => void signOut()}>
            <LogOut size={17} aria-hidden="true" /><span>{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</span>
          </button>}
        </nav>
      </div>
    </header>
    <main className={styles.shell}>
      {message && <p role="alert" className={styles.error}>{message}</p>}
      {session === undefined
        ? <p role="status" className={styles.loading}>Cargando Mi ACTV…</p>
        : <RunnerHistory key={session.user.id + ':' + (session.user.email ?? '')} email={session.user.email} />}
    </main>
  </div>;
}

function RunnerHistory({ email }: { email?: string }) {
  const [dashboard, setDashboard] = useState<RunnerDashboard>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [claimingEvent, setClaimingEvent] = useState('');
  const today = localDay.format(new Date());

  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      try {
        const { data, error: loadError } = await supabase.rpc('actv_runner_dashboard').abortSignal(request.signal);
        if (request.signal.aborted) return;
        if (loadError || !data || !Array.isArray(data.registrations)) throw loadError ?? new Error('Dashboard unavailable');
        setDashboard(data as RunnerDashboard);
        setError(false);
      } catch {
        if (!request.signal.aborted) setError(true);
      }
    })();
    return () => request.abort();
  }, [refresh]);

  const retry = () => {
    setError(false);
    setRefresh((value) => value + 1);
  };
  const registrations = dashboard?.registrations ?? [];
  const ownEvents = new Set(registrations.filter((race) => race.personal).map((race) => race.event_id));
  const history = runnerHistory(registrations, today);
  const { upcoming, otherPast } = history;

  function rows(items: Registration[]) {
    return <ul className={styles.raceList}>
      {items.map((item) => <RaceRow key={item.event_id + ':' + item.folio} race={item} today={today}
        canClaim={!ownEvents.has(item.event_id) && !claimingEvent}
        onClaimStart={() => setClaimingEvent(item.event_id)}
        onClaimComplete={(claimed) => {
          if (claimed) {
            setDashboard((current) => current && ({
              ...current,
              registrations: current.registrations.map((race) =>
                race.event_id === item.event_id ? { ...race, personal: race.folio === item.folio } : race),
            }));
          }
          setClaimingEvent('');
          setRefresh((value) => value + 1);
        }}
        onShareChange={(slug) => {
          setDashboard((current) => current && ({
            ...current,
            registrations: current.registrations.map((race) => race.event_id === item.event_id && race.folio === item.folio
              ? { ...race, achievement_slug: slug } : race),
          }));
        }} />)}
    </ul>;
  }

  return <div className={styles.history}>
    <section className={styles.passportHero} aria-labelledby="runner-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Mi ACTV / Pasaporte de corredor</p>
        <h1 id="runner-title">Tu historia<br />en la ruta.</h1>
        <p className={styles.heroDescription}>La próxima salida emociona. Las que ya viviste se quedan contigo.</p>
        {email && <p className={styles.runnerEmail}>{email}</p>}
      </div>
      <div className={styles.passportCount}>
        <svg className={styles.track} viewBox="0 0 360 280" fill="none" aria-hidden="true">
          <path d="M-40 235H215a91 91 0 0 0 0-182H140a55 55 0 0 0 0 110h260M-40 252H215a108 108 0 0 0 0-216H140a72 72 0 0 0 0 144h260" />
        </svg>
        <p className={styles.passportLabel}><Flag size={15} aria-hidden="true" /> Mi recorrido</p>
        <p className={styles.bigCount}>{dashboard ? String(history.count).padStart(2, '0') : '—'}</p>
        <p className={styles.countCaption}>{dashboard && history.count === 1 ? 'carrera con tu asistencia' : 'carreras con tu asistencia'}</p>
        <p className={styles.countFootnote}>Confirmada por el organizador</p>
      </div>
    </section>
    <nav className={styles.sectionNav} aria-label="Secciones de Mi ACTV">
      <a href="#inscripciones">Próximas salidas</a>
      <a href="#pasaporte">Mi pasaporte{dashboard ? ' · ' + history.count : ''}</a>
      <a href="#folios-anteriores">Otras inscripciones</a>
    </nav>
    <section id="inscripciones" className={styles.historyPanel} aria-labelledby="runner-history-title">
      <div className={styles.sectionHeader}>
        <h2 id="runner-history-title">Tu próxima salida</h2>
      </div>
      {!dashboard && (error
        ? <div className={styles.empty}>
          <p role="alert">No pudimos cargar tus folios.</p>
          <button type="button" className={styles.textButton} onClick={retry}>Volver a intentar <RefreshCw size={16} aria-hidden="true" /></button>
        </div>
        : <p role="status" className={styles.loading}>Cargando tus folios…</p>)}
      {dashboard && error && <div className={styles.stale}>
        <p role="alert">No pudimos actualizar tus folios.</p>
        <button type="button" className={styles.textButton} onClick={retry}>Volver a intentar <RefreshCw size={16} aria-hidden="true" /></button>
      </div>}
      {dashboard && (upcoming.length > 0
        ? rows(upcoming)
        : <div className={styles.empty}>
          <p>No tienes inscripciones próximas con este correo.</p>
          <Link href="/carreras" className={styles.textButton}>Encontrar una carrera <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>)}
      {dashboard && <details className={styles.help}>
        <summary>¿Falta un folio que compraste?</summary>
        <p>Revisa que el pago esté confirmado y que estés usando el correo que aparece en tu confirmación de compra.</p>
      </details>}
    </section>
    <section id="pasaporte" className={styles.passportSection} aria-labelledby="passport-title">
      <div className={styles.passportHeading}>
        <div>
          <p className={styles.eyebrow}>Cada salida cuenta</p>
          <h2 id="passport-title">Mi pasaporte de carreras</h2>
        </div>
        <span className={styles.passportTag}>Hecho en la ruta</span>
      </div>
      {!dashboard && <p role="status" className={styles.loading}>{error ? 'Tu pasaporte no está disponible. Vuelve a intentar arriba.' : 'Abriendo tu pasaporte…'}</p>}
      {dashboard && <>
        <ol className={styles.milestones} aria-label="Hitos de asistencia">
          {attendanceMilestones.map((milestone) => {
            const earned = history.count >= milestone.count;
            return <li key={milestone.count} data-earned={earned}>
              <div className={styles.stamp} aria-hidden="true">{earned ? <Check size={27} /> : String(milestone.count).padStart(2, '0')}</div>
              <strong>{milestone.label}</strong>
              <span>{milestone.count === 1 ? '1 carrera' : milestone.count + ' carreras'}</span>
              <small>{earned ? 'Conseguido' : 'Por vivir'}</small>
            </li>;
          })}
        </ol>
        {history.nextMilestone && <div className={styles.nextMilestone}>
          <p>{history.count === 0 ? 'Tu primer sello te espera.' : 'Tu siguiente historia ya está más cerca.'} <strong>{history.count} de {history.nextMilestone.count} asistencias</strong></p>
          <progress value={history.count} max={history.nextMilestone.count} aria-label={'Progreso a ' + history.nextMilestone.label} />
        </div>}
        {history.count >= 10 && <p className={styles.completedMilestones}>Diez carreras y las que vienen. Tu pasaporte sigue creciendo.</p>}
        <div className={styles.historyPanel}>
          {history.attended.length ? rows(history.attended) : <div className={styles.passportEmpty}>
            <Flag size={32} aria-hidden="true" />
            <h3>Aquí empieza tu colección.</h3>
            <p>Cuando marques tu folio y el organizador confirme tu asistencia, esa carrera tendrá un lugar en tu pasaporte.</p>
            <Link href="/carreras" className={styles.primary}>Elegir mi próxima carrera <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>}
        </div>
      </>}
    </section>
    <section id="folios-anteriores" className={styles.historyPanel} aria-labelledby="runner-past-title">
      <div className={styles.sectionHeader}><h2 id="runner-past-title">Otras inscripciones</h2></div>
      {!dashboard && <p className={styles.loading}>{error ? 'No pudimos cargar el historial.' : 'Cargando el historial…'}</p>}
      {dashboard && (otherPast.length
        ? rows(otherPast)
        : <div className={styles.empty}><p>No tienes otras inscripciones anteriores.</p></div>)}
      {dashboard && <p className={styles.historyNote}>Los folios de acompañantes y las asistencias sin confirmar permanecen aquí. Solo tu asistencia confirmada suma a tu pasaporte.</p>}
    </section>
  </div>;
}

function RaceRow({ race, today, canClaim, onClaimStart, onClaimComplete, onShareChange }: {
  race: Registration;
  today: string;
  canClaim: boolean;
  onClaimStart: () => void;
  onClaimComplete: (claimed: boolean) => void;
  onShareChange: (slug: string | null) => void;
}) {
  const [action, setAction] = useState<'claim' | 'publish' | 'revoke' | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const path = race.achievement_slug ? achievementPath(race.achievement_slug) : null;
  const upcoming = race.event_date >= today;

  async function copyFolio() {
    try {
      await navigator.clipboard.writeText(race.folio);
      setCopyMessage('Folio copiado.');
    } catch {
      setCopyMessage('Selecciona el número de folio para copiarlo.');
    }
  }

  function choose(next: typeof action) {
    setError('');
    setAction(next);
  }

  async function applyAction() {
    if (!action || working || (action === 'claim' && !canClaim)) return;
    setWorking(true);
    setError('');
    const args = { p_event_id: race.event_id, p_folio: race.folio };
    let claimed = false;
    if (action === 'claim') onClaimStart();
    try {
      if (action === 'claim') {
        const { data, error: claimError } = await supabase.rpc('actv_claim_runner_folio', args);
        if (claimError || data !== true) throw claimError ?? new Error('Folio unavailable');
        claimed = true;
      } else if (action === 'publish') {
        const { data: slug, error: publishError } = await supabase.rpc('actv_publish_achievement', args);
        if (publishError || typeof slug !== 'string' || !achievementPath(slug)) {
          throw publishError ?? new Error('Invalid share link');
        }
        onShareChange(slug);
      } else {
        const { data, error: revokeError } = await supabase.rpc('actv_unpublish_achievement', args);
        if (revokeError || data !== true) throw revokeError ?? new Error('Link unavailable');
        onShareChange(null);
      }
      setAction(null);
    } catch {
      setError({
        claim: 'No pudimos marcar el folio como tuyo. Puede que ya hayas elegido otro para esta carrera.',
        publish: 'No pudimos crear el enlace. Inténtalo de nuevo.',
        revoke: 'No pudimos desactivar el enlace. Inténtalo de nuevo.',
      }[action]);
    } finally {
      if (action === 'claim') onClaimComplete(claimed);
      setWorking(false);
    }
  }

  return <li className={styles.race}>
    <div className={styles.raceInformation}>
      <div className={styles.raceText}>
        <h3>{race.event_name}</h3>
        <p><time dateTime={race.event_date}>{raceDate.format(new Date(race.event_date + 'T12:00:00Z'))}</time>
          <span aria-hidden="true"> · </span><span>Folio <strong className={styles.folio}>{race.folio}</strong></span></p>
        <p className={styles.raceStatus} data-attended={race.attended}>
          {race.attended && <CheckCircle2 size={15} aria-hidden="true" />}
          {race.attended ? 'Asistencia confirmada' : upcoming ? 'Inscripción confirmada' : 'Asistencia sin confirmar'}
          {race.personal && <span className={styles.ownFolio}>Mi folio</span>}
        </p>
        {copyMessage && <p role="status">{copyMessage}</p>}
      </div>
      {upcoming && race.personal && <button type="button" className={styles.secondary} onClick={() => void copyFolio()}>
        <Clipboard size={16} aria-hidden="true" /> Copiar folio
      </button>}
      {canClaim && !action && <button type="button" className={styles.secondary} onClick={() => choose('claim')}>
        <UserCheck size={16} aria-hidden="true" /> Marcar como mi folio
      </button>}
      {race.personal && race.attended && !path && !action && <button type="button" className={styles.secondary} onClick={() => choose('publish')}>
        <Share2 size={16} aria-hidden="true" /> Compartir asistencia
      </button>}
    </div>
    {action && <div className={styles.sharePanel}>
      <p>{{
        claim: 'Elige el folio con el que tú corres. Puedes marcar un solo folio por carrera.',
        publish: 'Cualquiera con el enlace podrá ver la carrera, la fecha y que asististe. Puedes desactivarlo después.',
        revoke: 'El enlace dejará de mostrar tu asistencia aunque alguien ya lo haya guardado.',
      }[action]}</p>
      <div className={styles.shareActions}>
        <button type="button" disabled={working || (action === 'claim' && !canClaim)} className={styles.primary} onClick={() => void applyAction()}>
          {working ? 'Guardando…' : { claim: 'Confirmar mi folio', publish: 'Crear enlace público', revoke: 'Desactivar enlace' }[action]}
        </button>
        <button type="button" disabled={working} className={styles.textButton} onClick={() => choose(null)}>Cancelar</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>}
    {race.personal && race.attended && path && !action && <ShareLinks path={path} eventName={race.event_name} onRevoke={() => choose('revoke')} />}
  </li>;
}

function ShareLinks({ path, eventName, onRevoke }: { path: string; eventName: string; onRevoke: () => void }) {
  const [message, setMessage] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const field = useRef<HTMLInputElement>(null);

  function showCopyField(url: string) {
    setManualUrl(url);
    setMessage('Selecciona y copia el enlace.');
  }

  useEffect(() => {
    if (!manualUrl) return;
    field.current?.focus();
    field.current?.select();
  }, [manualUrl]);

  async function copy() {
    const url = new URL(path, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl('');
      setMessage('Enlace copiado.');
    } catch {
      showCopyField(url);
    }
  }

  async function share() {
    if (typeof navigator.share !== 'function') {
      await copy();
      return;
    }
    const url = new URL(path, window.location.origin).href;
    try {
      await navigator.share({ title: eventName, text: 'Mi asistencia en ACTV', url });
      setMessage('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showCopyField(url);
    }
  }

  return <div className={styles.sharePanel}>
    <p>Tu asistencia tiene un enlace público.</p>
    <div className={styles.shareActions}>
      <button type="button" className={styles.secondary} onClick={() => void share()}>
        <Share2 size={16} aria-hidden="true" /> Compartir
      </button>
      <button type="button" className={styles.textButton} onClick={() => void copy()}>
        <Clipboard size={16} aria-hidden="true" /> Copiar enlace
      </button>
      <Link href={path} target="_blank" rel="noopener noreferrer" className={styles.textButton}>
        Ver página pública <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
      <button type="button" className={styles.textButton} onClick={onRevoke}>Desactivar enlace</button>
    </div>
    {message && <p role="status" className={styles.shareNotice}><Check size={15} aria-hidden="true" />{message}</p>}
    {manualUrl && <input readOnly value={manualUrl} ref={field} aria-label="Enlace público del logro" />}
  </div>;
}

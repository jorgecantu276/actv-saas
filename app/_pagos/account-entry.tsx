'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Mail, MoveUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { actvDisplay } from './public-type';
import { useClientReady } from '@/lib/use-client-ready';
import styles from './account-entry.module.css';

const copy = {
  runner: {
    signupTitle: 'Crea tu cuenta de corredor',
    loginTitle: 'Entra a Mi ACTV',
    otherPath: '/organizadores',
    otherLabel: 'Soy organizador',
  },
  organizer: {
    signupTitle: 'Crea tu cuenta de organizador',
    loginTitle: 'Entra a tu panel',
    otherPath: '/mi-actv',
    otherLabel: 'Soy corredor',
  },
} as const;

type Mode = 'signup' | 'login' | 'password';

function localMailbox() {
  const address = process.env.NEXT_PUBLIC_ACTV_LOCAL_MAIL_URL;
  if (!address || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return '';
  const url = URL.parse(address);
  return url?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) ? url.href : '';
}

type AccountEntryProps = {
  audience: keyof typeof copy;
  returnPath: string;
  linkFailed?: boolean;
};
export function AccountEntry(props: AccountEntryProps) {
  const ready = useClientReady();
  return ready ? <AccountEntryBody key={[props.audience, props.returnPath, props.linkFailed].join(':')} {...props} /> : null;
}
function AccountEntryBody({ audience, returnPath, linkFailed = false }: AccountEntryProps) {
  const labels = copy[audience];
  const expiredMessage = 'Este enlace ya no está disponible. Pide uno nuevo.';
  const [failedFragment] = useState(() => new URLSearchParams(window.location.hash.slice(1)).has('error_code'));
  const failed = linkFailed || failedFragment;
  const [mode, setMode] = useState<Mode>(failed ? 'login' : 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState(failed ? expiredMessage : '');

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('error_code')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  function select(next: Mode) {
    setMode(next);
    setPassword('');
    setError('');
    setSentTo('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const address = email.trim();
    setError('');
    setPending(true);
    try {
      if (mode === 'password') {
        const result = await supabase.auth.signInWithPassword({ email: address, password });
        if (result.error) setError('Revisa tu correo y contraseña, o pide un enlace de acceso.');
        return;
      }

      const redirect = new URL(returnPath, window.location.origin);
      const callback = redirect.origin === window.location.origin ? redirect : new URL(window.location.pathname, window.location.origin);
      const result = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: mode === 'signup', emailRedirectTo: callback.href },
      });
      if (result.error?.status === 429) {
        setError('Espera un minuto antes de pedir otro enlace.');
      } else if (result.error && (mode === 'signup' || result.error.code !== 'otp_disabled')) {
        setError('No pudimos enviar el enlace. Vuelve a intentarlo.');
      } else {
        setSentTo(address);
      }
    } catch {
      setError('No pudimos conectar con ACTV. Vuelve a intentarlo.');
    } finally {
      setPending(false);
    }
  }

  const mailbox = sentTo ? localMailbox() : '';

  return (
    <main className={actvDisplay.variable + ' ' + styles.surface}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/inicio" aria-label="Inicio de ACTV">
          <Image src="/icon-public.png" alt="" width={43} height={43} />
        </Link>
        <nav className={styles.nav} aria-label="Accesos de ACTV">
          <Link href="/carreras">Ver carreras</Link>
          <Link href={labels.otherPath}>{labels.otherLabel} <MoveUpRight size={13} aria-hidden /></Link>
        </nav>
      </header>
      <div className={styles.layout}>
        <figure className={styles.imagePanel}>
          <Image src="/actv-corredores-matamoros.jpg" alt="Corredores de ACTV en Matamoros" fill sizes="(max-width: 760px) 95vw, 49vw" />
          <figcaption>Matamoros, Tamaulipas · Foto de ACTV</figcaption>
        </figure>
        <section className={styles.formPanel} aria-labelledby="account-entry-title">
          <div className={styles.formInner}>
            <div className={styles.switcher} role="group" aria-label="Acceso a tu cuenta">
              <button type="button" aria-pressed={mode === 'signup'} onClick={() => select('signup')} disabled={pending}>Crear cuenta</button>
              <button type="button" aria-pressed={mode !== 'signup'} onClick={() => select('login')} disabled={pending}>Iniciar sesión</button>
            </div>
            {sentTo ? (
              <div className={styles.sent}>
                <div className={styles.mailIcon}><Mail size={24} aria-hidden /></div>
                <div role="status">
                  <h1 id="account-entry-title">Revisa tu correo</h1>
                  {mode === 'signup'
                    ? <p>Enviamos un enlace a <strong>{sentTo}</strong>. Ábrelo para confirmar tu correo y entrar.</p>
                    : <p>Si hay una cuenta con el correo <strong>{sentTo}</strong>, recibirás un enlace para entrar.</p>}
                </div>
                {mailbox && <a className={styles.submit} href={mailbox} target="_blank" rel="noreferrer">Abrir buzón de prueba <MoveUpRight size={16} aria-hidden /></a>}
                <button className={styles.textButton} type="button" onClick={() => select(mode)}><ArrowLeft size={15} aria-hidden /> Cambiar correo o pedir otro enlace</button>
              </div>
            ) : (
              <>
                <h1 id="account-entry-title">{mode === 'signup' ? labels.signupTitle : labels.loginTitle}</h1>
                <p>{mode === 'password' ? 'Usa el correo y la contraseña de tu cuenta de ACTV.' : 'Te enviamos un enlace para confirmar tu correo y entrar.'}</p>
                <form onSubmit={submit}>
                  <label htmlFor="account-email">Correo electrónico</label>
                  <input id="account-email" type="email" autoComplete="email" placeholder="tucorreo@ejemplo.com" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
                  {mode === 'password' && (
                    <>
                      <label htmlFor="account-password">Contraseña</label>
                      <input id="account-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
                    </>
                  )}
                  {error && <p className={styles.error} role="alert">{error}</p>}
                  <button className={styles.submit} type="submit" disabled={pending}>
                    {pending ? 'Un momento…' : mode === 'password' ? 'Entrar' : 'Enviar enlace'} <ArrowRight size={18} aria-hidden />
                  </button>
                </form>
                {audience === 'organizer' && mode !== 'signup' && (
                  <button className={styles.textButton} type="button" onClick={() => select(mode === 'password' ? 'login' : 'password')} disabled={pending}>
                    {mode === 'password' ? 'Entrar con enlace por correo' : 'Entrar con contraseña'}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check } from 'lucide-react';
import { goToCheckout, paymentFunction, PaymentsError, type OrderStatus } from '../../_pagos/api';
import { PublicSite, raceDate } from '../../_pagos/public-site';
import { RacePhoto } from '../../_pagos/race-art';
import styles from '../../_pagos/race-journey.module.css';

const labels: Record<OrderStatus['status'], string> = {
  pending: 'Confirmación pendiente', issued: 'Inscripción confirmada', closed: 'Pedido cerrado',
  review: 'Pedido en revisión', voided: 'Inscripción anulada',
};

const orderMessages: Partial<Record<OrderStatus['status'], string>> = {
  closed: 'El pedido se cerró. Para inscribirte, consulta si todavía hay lugares en la página de la carrera.',
  review: 'El pedido está en revisión. Guarda este enlace para consultar la resolución.',
  voided: 'El folio de este pedido quedó anulado.',
};

function statusToken(orderId: string) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) return token;
  try { return sessionStorage.getItem(`actv:payment:${orderId}`); } catch { return null; }
}

function paymentId() {
  const value = new URLSearchParams(window.location.search).get('payment_id');
  return value && /^[1-9]\d{0,18}$/.test(value) ? value : undefined;
}

export default function Status({ orderId, canceled }: { orderId: string; canceled: boolean }) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');
  const [pollRound, setPollRound] = useState(0);
  const [checking, setChecking] = useState(true);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    const token = statusToken(orderId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    async function checkOrder() {
      if (!orderId || !token) {
        setError('Abre el enlace completo del pedido para consultar tu inscripción.');
        setChecking(false);
        return;
      }
      try {
        const current = await paymentFunction<OrderStatus>('actv-checkout', { action: 'status', orderId, orderToken: token, paymentId: paymentId() }, request.signal);
        if (request.signal.aborted) return;
        setError('');
        setOrder(current);
        if (current.status === 'pending' && attempts < 8) {
          attempts += 1;
          timer = setTimeout(checkOrder, Math.min(3000 * 2 ** (attempts - 1), 18_000) + Math.random() * 1000);
        } else {
          setChecking(false);
        }
      } catch (cause) {
        if (request.signal.aborted) return;
        setError(cause instanceof PaymentsError && (cause.status === 403 || cause.status === 404)
          ? 'No encontramos el pedido con este enlace.'
          : 'No pudimos consultar el pedido. Intenta actualizar el estado.');
        setChecking(false);
      }
    }

    void checkOrder();
    return () => { request.abort(); clearTimeout(timer); };
  }, [orderId, pollRound]);

  async function resumeCheckout() {
    const token = statusToken(orderId);
    if (!token || resuming) return;
    setResuming(true);
    setError('');
    try {
      const result = await paymentFunction<OrderStatus & { checkoutUrl?: string }>('actv-checkout', {
        action: 'resume', orderId, orderToken: token, paymentId: paymentId(),
      });
      if (result.checkoutUrl) {
        goToCheckout(result.checkoutUrl, result.provider ?? 'stripe');
        return;
      }
      setOrder((current) => current && current.status !== 'pending' && result.status === 'pending' ? current : result);
      if (result.status === 'pending') setError('El pago sigue pendiente. Vuelve a consultar el estado.');
    } catch {
      setError('No pudimos abrir el pago. Vuelve a consultar el estado del pedido.');
    }
    setResuming(false);
  }

  const confirmed = Boolean(order?.status === 'issued' && order.folios.length > 0);
  const title = order && (order.status !== 'issued' || confirmed) ? labels[order.status] : 'Estado de la inscripción';

  return (
    <PublicSite>
      <div className={styles.section}>
        <Link className={styles.back} href="/carreras"><ArrowLeft size={16} aria-hidden="true" /> Calendario</Link>
        <header className={`${styles.heading} ${styles.statusHeading}`} aria-live="polite">
          <p className={styles.kicker}>Inscripción</p>
          <h1>{title}</h1>
        </header>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {confirmed && order ? (
          <div className={styles.ticketLayout}>
            <section className={styles.ticket} aria-label="Folios de la inscripción">
              <div className={styles.ticketHead}>
                <span>{order.folios.length === 1 ? 'Tu folio' : 'Tus folios'}</span>
                <Check size={18} aria-hidden="true" />
              </div>
              <div className={styles.ticketBody}>
                {order.race && (
                  <>
                    <h2>{order.race.name}</h2>
                    {(order.race.date || order.race.distance) && <p className={styles.raceMeta}>
                      {order.race.date && <time dateTime={order.race.date}>{raceDate(order.race.date)}</time>}
                      {order.race.distance && order.race.distance !== 'Por confirmar' && <span>{order.race.distance}</span>}
                    </p>}
                  </>
                )}
                <ul className={`${styles.folios} ${order.folios.length === 1 ? styles.singleFolio : ''}`} role="list">
                  {order.folios.map((folio) => <li key={folio}>{folio}</li>)}
                </ul>
              </div>
              <div className={styles.ticketFoot}>
                <p>Entra con el correo que usaste para inscribirte y encuentra tu folio en Mi ACTV.</p>
                <Link href="/mi-actv" className={styles.outline}>Ir a Mi ACTV <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
            </section>
            <RacePhoto className={styles.ticketPhoto} sizes="(max-width: 760px) 90vw, 480px" />
          </div>
        ) : (
          <div className={styles.statePanel} aria-live="polite">
            {!order && !error && <p role="status">Consultando el estado del pedido…</p>}
            {order && (
              <p>
                {order.status === 'pending'
                  ? canceled ? 'El pago sigue pendiente. Puedes volver al pago o consultar el estado.'
                    : 'Estamos esperando la confirmación del pago. Guarda este enlace para consultar tus folios.'
                  : orderMessages[order.status] ?? 'Guarda este enlace para consultar tu pedido.'}
              </p>
            )}
            {orderId && (
              <div className={styles.stateActions}>
                {canceled && order?.status === 'pending' && <button type="button" className={styles.action} disabled={resuming} onClick={resumeCheckout}>{resuming ? 'Abriendo pago…' : 'Volver al pago'}</button>}
                <button type="button" className={styles.outline} disabled={checking || resuming} onClick={() => { setChecking(true); setError(''); setPollRound((round) => round + 1); }}>{checking ? 'Consultando…' : 'Actualizar estado'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </PublicSite>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { goToStripe, paymentFunction, PaymentsError, type OrderStatus } from '../../_pagos/api';
import { PaymentAlert, PaymentPage, paymentButton, secondaryButton } from '../../_pagos/ui';

const labels: Record<OrderStatus['status'], string> = {
  pending: 'Confirmación pendiente', issued: 'Inscripción confirmada', closed: 'Pedido cerrado',
  review: 'Pedido en revisión', voided: 'Inscripción anulada',
};

const orderMessages: Partial<Record<OrderStatus['status'], string>> = {
  closed: 'El pedido se cerró. Para inscribirte, consulta si todavía hay lugares en la página de la carrera.',
  review: 'El pedido está en revisión. Guarda este enlace para consultar la resolución.',
  voided: 'El folio de este pedido quedó anulado.',
};

const statusToken = () => new URLSearchParams(window.location.hash.slice(1)).get('token');

export default function Status({ orderId, canceled }: { orderId: string; canceled: boolean }) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');
  const [pollRound, setPollRound] = useState(0);
  const [checking, setChecking] = useState(true);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    const token = statusToken();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    async function checkOrder() {
      if (!orderId || !token) {
        setError('Abre el enlace completo del pedido para consultar tu inscripción.');
        setChecking(false);
        return;
      }
      try {
        const current = await paymentFunction<OrderStatus>('actv-checkout', { action: 'status', orderId, orderToken: token }, request.signal);
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
    const token = statusToken();
    if (!token || resuming) return;
    setResuming(true);
    setError('');
    try {
      const result = await paymentFunction<OrderStatus & { checkoutUrl?: string }>('actv-checkout', {
        action: 'resume', orderId, orderToken: token,
      });
      if (result.checkoutUrl) {
        goToStripe(result.checkoutUrl, 'checkout');
        return;
      }
      setOrder((current) => current && current.status !== 'pending' && result.status === 'pending' ? current : result);
      if (result.status === 'pending') setError('Stripe aún está procesando el pedido. Vuelve a consultar el estado.');
    } catch {
      setError('No pudimos abrir el pago. Vuelve a consultar el estado del pedido.');
    }
    setResuming(false);
  }

  const confirmed = Boolean(order?.status === 'issued' && order.folios.length > 0);
  const title = order && (order.status !== 'issued' || confirmed) ? labels[order.status] : 'Estado de la inscripción';

  return (
    <PaymentPage label="Inscripción en línea" title={title}>
      {error && <PaymentAlert>{error}</PaymentAlert>}
      <div aria-live="polite" className="mt-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
        {!order && !error && <p role="status">Consultando el estado del pedido…</p>}
        {confirmed && order && (
          <>
            <h2 className="font-sans text-lg font-semibold">{order.folios.length === 1 ? 'Tu folio' : 'Tus folios'}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {order.folios.map((folio) => <li key={folio} className="rounded-lg bg-emerald-50 px-4 py-3 font-mono text-lg font-bold text-emerald-900">{folio}</li>)}
            </ul>
          </>
        )}
        {order && !confirmed && (
          <p className="text-slate-700">
            {order.status === 'pending'
              ? canceled ? 'Regresaste de Stripe antes de que se confirmara el pago. Guarda el enlace para revisar el pedido.'
                : 'Estamos esperando la confirmación del pago. Guarda este enlace para consultar tus folios.'
              : orderMessages[order.status] ?? 'Guarda este enlace para consultar tu pedido.'}
          </p>
        )}
        {orderId && !confirmed && (
          <div className="mt-4 flex flex-wrap gap-3">
            {canceled && order?.status === 'pending' && <button type="button" className={paymentButton} disabled={resuming} onClick={resumeCheckout}>{resuming ? 'Abriendo Stripe…' : 'Volver al pago'}</button>}
            <button type="button" className={secondaryButton} disabled={checking || resuming} onClick={() => { setChecking(true); setError(''); setPollRound((round) => round + 1); }}>{checking ? 'Consultando…' : 'Actualizar estado'}</button>
          </div>
        )}
      </div>
    </PaymentPage>
  );
}

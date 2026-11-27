'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Invitation = { id: string; recipient_email: string; expires_at: string; state: string };
type Status = { linked: boolean; personal: boolean; can_invite: boolean; staff_verification: boolean; payment_known: boolean; invitation: Invitation | null };

export default function ParticipantLinking({ registrationId }: { registrationId: string }) {
  return <ParticipantLinkingForm key={registrationId} registrationId={registrationId} />;
}

function ParticipantLinkingForm({ registrationId }: { registrationId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('buyer_contact');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const attempt = useRef<{ id: string; token: string; signature: string } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    void supabase.rpc('actv_participant_link_status', { p_registration_id: registrationId }).then(({ data, error }) => {
      if (generation.current !== current) return;
      if (error) setMessage('No pudimos consultar la vinculación. Verifica tu acceso.');
      else { setStatus(data); setMethod(data.staff_verification ? 'in_person' : 'buyer_contact'); }
    });
    return () => { generation.current = current + 1; };
  }, [registrationId]);

  async function issue() {
    const current = generation.current;
    const signature = JSON.stringify([registrationId, email.trim().toLowerCase(), reason.trim(), method]);
    if (attempt.current?.signature !== signature) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      attempt.current = { id: crypto.randomUUID(), token: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), signature };
    }
    const request = attempt.current;
    setBusy(true); setMessage(''); setLink('');
    const { data, error } = await supabase.rpc('actv_create_participant_invitation', {
      p_registration_id: registrationId, p_recipient_email: email.trim().toLowerCase(), p_request_id: request.id,
      p_token: request.token, p_reason: reason.trim(), p_verification_method: method,
    });
    if (generation.current !== current) return;
    setBusy(false);
    if (error) { setMessage('No pudimos crear la invitación. Revisa el correo, la verificación y el estado del folio. Puedes reintentar.'); return; }
    setStatus(previous => previous && ({ ...previous, invitation: data }));
    if (data.state === 'pending') {
      setLink(window.location.origin + '/mi-actv#vincular=' + request.token);
      setMessage('Invitación creada. Comparte el enlace en privado con la persona verificada. También aparecerá al iniciar sesión con ese correo.');
    } else setMessage('Esta solicitud ya fue procesada. Consulta su estado antes de crear otra invitación.');
  }

  async function revoke() {
    if (!status?.invitation) return;
    const current = generation.current;
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('actv_revoke_participant_invitation', { p_request_id: status.invitation.id, p_reason: reason.trim() });
    if (generation.current !== current) return;
    setBusy(false);
    if (error) { setMessage('No pudimos revocar la invitación. Escribe un motivo de al menos 10 caracteres y verifica tu acceso.'); return; }
    setStatus(previous => previous && ({ ...previous, invitation: data }));
    setLink(''); attempt.current = null; setMessage('Invitación revocada. El enlace anterior ya no puede vincular el folio.');
  }

  return <section aria-label="Vinculación personal del participante">
    <h3>Vinculación personal</h3>
    <p>Comprar o registrar un folio no lo agrega automáticamente al historial personal. La persona debe aceptar con su correo confirmado.</p>
    {status?.linked && <p>Este folio ya tiene una persona vinculada. Una corrección de contacto no cambia su titular.</p>}
    {status && !status.payment_known && <p>Registro histórico: esta verificación identifica al participante; no confirma un pago.</p>}
    {status?.invitation && <p>Invitación: {status.invitation.recipient_email} · {status.invitation.state} · vence {new Date(status.invitation.expires_at).toLocaleString('es-MX')}</p>}
    {status?.can_invite && <form onSubmit={event => { event.preventDefault(); void issue(); }}>
      <label>Correo confirmado del participante <input type="email" required maxLength={250} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <label>Verificación <select aria-label="Verificación" value={method} onChange={event => setMethod(event.target.value)} disabled={busy}>
        <option value="buyer_contact">Comprador: confirmación directa del participante</option>
        {status.staff_verification && <><option value="in_person">Personal: identidad verificada en persona</option><option value="purchase_contact">Personal: contacto de compra verificado</option></>}
      </select></label>
      <label>Motivo y referencia de verificación (sin documentos de identidad) <textarea required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Procesando…' : 'Crear invitación privada'}</button>
    </form>}
    {status?.invitation?.state === 'pending' && <><label>Motivo para revocar <input minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label><button type="button" disabled={busy || reason.trim().length < 10} onClick={() => void revoke()}>Revocar invitación</button></>}
    {link && <p><button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage('Enlace privado copiado.'), () => setMessage('No se pudo copiar. Selecciona el enlace privado.'))}>Copiar enlace privado</button> <input aria-label="Enlace privado de invitación" readOnly value={link} onFocus={event => event.target.select()} /></p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

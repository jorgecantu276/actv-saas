'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import ParticipantLinking from '@/components/ParticipantLinking';

type Inventory = {
  total: number; incoming_total: number;
  registrations: { registration_id: string; event_name: string; folio: string; personal: boolean; can_invite: boolean }[];
  incoming: { id: string; event_name: string; folio: string; expires_at: string }[];
};

export default function ParticipantLinkRedeemer({ onLinked }: { onLinked?: () => void }) {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fragmentToken = useRef<string | null>(null);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get('vincular') ?? fragmentToken.current;
    let active = true;
    if (value && /^[a-f0-9]{64}$/.test(value)) {
      fragmentToken.current = value;
      queueMicrotask(() => { if (active) setToken(value); });
    }
    if (fragment.has('vincular')) {
      fragment.delete('vincular');
      history.replaceState(null, '', window.location.pathname + window.location.search + (fragment.size ? '#' + fragment.toString() : ''));
    }
    return () => { active = false; };
  }, []);
  if (!token) return null;
  async function accept() {
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('actv_accept_participant_invitation', { p_token: token });
    setBusy(false);
    if (error) setMessage('No pudimos vincular el folio. Usa el correo confirmado de la invitación; también puede haber vencido o sido revocada.');
    else { fragmentToken.current = null; setToken(''); window.dispatchEvent(new Event('actv-participant-linked')); onLinked?.(); }
  }
  return <section aria-label="Aceptar invitación privada"><h2>Invitación a tu historial</h2><p>Aceptar vincula este folio a tu cuenta personal. Comprueba que iniciaste sesión con el correo al que se envió la invitación.</p><button disabled={busy} onClick={() => void accept()}>{busy ? 'Vinculando…' : 'Aceptar invitación'}</button>{message && <p role="alert">{message}</p>}</section>;
}

export function ParticipantInvitationInbox({ onLinked }: { onLinked?: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('actv-participant-linked', refresh);
    return () => window.removeEventListener('actv-participant-linked', refresh);
  }, []);
  useEffect(() => {
    let active = true;
    void supabase.rpc('actv_my_participant_links', { p_offset: offset, p_limit: 10 }).then(({ data, error }) => {
      if (!active) return;
      if (error) { setInventory(null); setMessage('Confirma tu correo para consultar invitaciones y folios.'); }
      else { setInventory(data); setMessage(''); }
    });
    return () => { active = false; };
  }, [offset, revision]);
  async function accept(id: string) {
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('actv_accept_my_participant_invitation', { p_request_id: id });
    setBusy(false);
    if (error) setMessage('La invitación ya no está disponible para tu cuenta. Verifica el correo confirmado o solicita una nueva.');
    else { setRevision(value => value + 1); onLinked?.(); }
  }
  return <section aria-label="Invitaciones y folios de compra"><h2>Invitaciones y folios</h2>
    <p>Las invitaciones se muestran únicamente al correo confirmado de su destinatario. Los folios de acompañantes permanecen separados de tu historial personal.</p>
    {inventory?.incoming.map(invitation => <article key={invitation.id}><h3>{invitation.event_name} · Folio {invitation.folio}</h3><p>Vence {new Date(invitation.expires_at).toLocaleString('es-MX')}</p><button disabled={busy} onClick={() => void accept(invitation.id)}>Vincular a mi historial</button></article>)}
    {inventory?.registrations.map(registration => <article key={registration.registration_id}><h3>{registration.event_name} · Folio {registration.folio}</h3><p>{registration.personal ? 'Vinculado a tu historial personal' : 'Folio de tu compra'}</p>{registration.can_invite && <ParticipantLinking registrationId={registration.registration_id} />}</article>)}
    {inventory && !inventory.incoming_total && !inventory.total && <p>No tienes invitaciones ni folios de compra disponibles.</p>}
    {inventory && Math.max(inventory.total, inventory.incoming_total) > 10 && <p><button disabled={!offset || busy} onClick={() => setOffset(value => Math.max(0, value - 10))}>Anterior</button> <button disabled={busy || offset + 10 >= Math.max(inventory.total, inventory.incoming_total)} onClick={() => setOffset(value => value + 10)}>Siguiente</button></p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

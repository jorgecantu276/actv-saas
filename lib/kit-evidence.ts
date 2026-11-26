import { supabase } from './supabase';

type Evidence = { id: string; path: string; state: 'reserved' | 'committed' | 'rejected' | 'deleted'; legal_hold?: boolean };
async function operation(registration: string, request: string, action: string): Promise<Evidence> {
  const { data, error } = await supabase.functions.invoke('actv-kit-evidence', { body: { registration, request, action } });
  if (error || !data?.state) throw new Error('No se pudo confirmar la operación. Reintenta para consultar su estado.');
  return data as Evidence;
}

export async function handoverKit(registration: string, file: File) {
  // The identity survives closing/reopening the modal, reloads, and lost responses.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Inicia sesión antes de entregar un kit.');
  const key = `actv-kit-request:${session.user.id}:${registration}`;
  let request = localStorage.getItem(key);
  if (!request) { request = crypto.randomUUID(); localStorage.setItem(key, request); }
  let evidence = await operation(registration, request, 'reserve');
  if (evidence.state === 'reserved') {
    const uploaded = await supabase.storage.from('evidencias_kits').upload(evidence.path, file,
      { contentType: 'image/jpeg', upsert: false });
    // A duplicate can mean a prior upload succeeded before its response was lost.
    // Finalize checks the real object and registration atomically. Never compensate
    // an unknown finalization by deleting an object that may already be committed.
    if (uploaded.error && !['409', 'Duplicate'].includes(String(uploaded.error.statusCode ?? uploaded.error.name))) {
      evidence = await operation(registration, request, 'status');
      if (evidence.state !== 'committed') throw new Error('Carga pendiente de confirmación. Reintenta con la misma inscripción.');
    } else evidence = await operation(registration, request, 'finalize');
  }
  if (evidence.state !== 'committed') {
    localStorage.removeItem(key);
    throw new Error('El folio cambió de estado. Consulta la inscripción antes de entregar el kit.');
  }
  localStorage.removeItem(key);
}

export async function evidenceBlob(registration: string) {
  const evidence = await operation(registration, '', 'view');
  const { data, error } = await supabase.storage.from('evidencias_kits').download(evidence.path);
  if (error || !data) throw new Error('Evidencia no disponible para tu acceso actual.');
  return URL.createObjectURL(data);
}

export function evidenceReference(registration: string) { return operation(registration, '', 'view'); }

export async function recoverKitHandover(registration: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const key = `actv-kit-request:${session.user.id}:${registration}`;
  const request = localStorage.getItem(key);
  if (!request) return false;
  // Reserve is idempotent even when the original reserve response was lost before
  // its transaction began; a status-only lookup could otherwise strand the key.
  const evidence = await operation(registration, request, 'reserve');
  if (evidence.state === 'committed') { localStorage.removeItem(key); return true; }
  if (['rejected', 'deleted'].includes(evidence.state)) localStorage.removeItem(key);
  return false;
}

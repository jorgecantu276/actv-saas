'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@supabase/supabase-js';
import { provisionStaff, validateStaffProfile, validateStaffPassword, type StaffInput, type StaffProfileInput } from '@/lib/staff-provisioning';

async function verifyManager(accessToken: string) {
  if (!accessToken) throw Error('Inicia sesión como administrador.');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await client.auth.getUser(accessToken);
  if (identityError || !identity.user) throw Error('Sesión de administración inválida.');
  const { data, error } = await client.rpc('actv_is_payment_manager');
  if (error || data !== true) throw Error('Acción reservada para administración.');
  return client;
}

async function setAccess(client: Awaited<ReturnType<typeof verifyManager>>, uid: string, profile: StaffProfileInput, active = true) {
  const { error } = await client.rpc('actv_set_staff_access', {
    p_user: uid, p_name: profile.nombre_completo, p_phone: profile.telefono,
    p_role: profile.rol, p_events: profile.eventos_asignados, p_active: active,
  });
  if (error) throw Error(error.message);
}

export async function crearAccesoUsuario(formData: StaffInput, accessToken: string, retainedUserId?: string) {
  try {
    let client: Awaited<ReturnType<typeof verifyManager>>;
    return await provisionStaff(formData, {
      authorize: async () => { client = await verifyManager(accessToken); },
      createIdentity: async input => {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: input.email, password: input.password, email_confirm: true,
          // Only the trusted server sets this recoverable identity marker.
          // Neither app nor user metadata confers a role or event permission.
          app_metadata: { actv_staff_identity: true },
          user_metadata: { nombre_completo: input.nombre_completo, telefono: input.telefono },
        });
        if (error || !data.user) throw Error('No se confirmó la creación de la cuenta. Recarga Personal para revisar cuentas pendientes antes de reintentar.');
        return data.user.id;
      },
      readIdentityEmail: async uid => {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (error) throw Error('No se pudo comprobar la cuenta pendiente.');
        return data.user?.email;
      },
      applyAccess: (uid, profile) => setAccess(client!, uid, profile),
    }, retainedUserId);
  } catch (error: unknown) {
    return { success: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function actualizarAccesoUsuario(uid: string, formData: StaffProfileInput, accessToken: string) {
  try {
    const client = await verifyManager(accessToken);
    await setAccess(client, uid, validateStaffProfile(formData));
    return { success: true as const };
  } catch (error: unknown) {
    return { success: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function vincularAccesoExistente(formData: StaffProfileInput & { email: string }, accessToken: string) {
  let retainedUserId: string | undefined;
  try {
    const client = await verifyManager(accessToken);
    const profile = validateStaffProfile(formData);
    const email = formData.email?.trim().toLowerCase();
    if (!email) throw Error('Indica el correo de la cuenta existente.');
    const { data: uid, error: lookupError } = await client.rpc('actv_find_staff_identity', { p_email: email });
    if (lookupError || typeof uid !== 'string') throw Error('No se pudo identificar la cuenta existente.');
    const { data, error: identityError } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (identityError || data.user?.email?.toLowerCase() !== email) throw Error('No se pudo confirmar la cuenta existente.');
    // This is an explicit manager adoption. Preserve Auth ID, password and
    // existing app metadata; mark the intent so an interrupted grant is visible.
    const { error: markerError } = await supabaseAdmin.auth.admin.updateUserById(uid, {
      app_metadata: { ...data.user.app_metadata, actv_staff_identity: true },
    });
    if (markerError) throw Error('No se confirmó la preparación de la cuenta. Recarga Personal antes de reintentar.');
    retainedUserId = uid;
    await setAccess(client, uid, profile);
    return { success: true as const };
  } catch (error: unknown) {
    return { success: false as const, pendingUserId: retainedUserId,
      error: error instanceof Error ? error.message : String(error) };
  }
}

export async function desactivarAccesoUsuario(uid: string, formData: StaffProfileInput, accessToken: string) {
  try {
    const client = await verifyManager(accessToken);
    await setAccess(client, uid, validateStaffProfile(formData), false);
    return { success: true as const };
  } catch (error: unknown) {
    return { success: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function actualizarContrasenaUsuario(uid: string, nuevaContrasena: string, accessToken: string) {
  try {
    validateStaffPassword(nuevaContrasena);
    const client = await verifyManager(accessToken);
    const { data, error: targetError } = await client.rpc('actv_staff_password_target', { p_user: uid });
    if (targetError || data !== true) throw Error('Cuenta de personal no autorizada.');
    const { error } = await supabaseAdmin.auth.admin.updateUserById(uid, { password: nuevaContrasena });
    if (error) throw Error(error.message);
    return { success: true as const };
  } catch (error: unknown) {
    return { success: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

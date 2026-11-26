export type StaffInput = {
  email: string; password: string; rol: string; nombre_completo: string;
  telefono: string; eventos_asignados: string[];
};
export type StaffProfileInput = Omit<StaffInput, 'email' | 'password'>;
const roles = ['Administrador', 'PDV ACTV', 'Cajero', 'Moderador'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function validateStaffPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw Error('La contraseña debe tener al menos 8 caracteres.');
  return value;
}

export function validateStaffProfile(value: StaffProfileInput) {
  if (!roles.includes(value.rol) || !value.nombre_completo?.trim() || value.nombre_completo.length > 150 ||
    typeof value.telefono !== 'string' || value.telefono.length > 60 ||
    !Array.isArray(value.eventos_asignados) || value.eventos_asignados.length > 1000 ||
    value.eventos_asignados.some(id => typeof id !== 'string' || !uuid.test(id)) ||
    (['Administrador', 'PDV ACTV'].includes(value.rol) && value.eventos_asignados.length)) {
    throw Error('Datos de personal inválidos.');
  }
  return { ...value, nombre_completo: value.nombre_completo.trim(), eventos_asignados: [...new Set(value.eventos_asignados)].sort() };
}

type ProvisionDependencies = {
  authorize: () => Promise<void>;
  createIdentity: (input: StaffInput) => Promise<string>;
  readIdentityEmail: (id: string) => Promise<string | undefined>;
  applyAccess: (id: string, profile: StaffProfileInput) => Promise<void>;
};

export async function provisionStaff(input: StaffInput, dependencies: ProvisionDependencies, retainedUserId?: string) {
  await dependencies.authorize();
  const profile = validateStaffProfile(input);
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Correo inválido.');
  validateStaffPassword(input.password);
  let id = retainedUserId;
  if (id) {
    if (!uuid.test(id) || (await dependencies.readIdentityEmail(id))?.toLowerCase() !== email) {
      throw Error('La cuenta pendiente no corresponde al correo indicado.');
    }
  } else id = await dependencies.createIdentity({ ...input, email, ...profile });
  try {
    await dependencies.applyAccess(id, profile);
    return { success: true as const };
  } catch {
    // Auth and Postgres cannot share a transaction. Keep the identity, report
    // activation as unconfirmed (the commit response may be lost), and retry
    // the same user rather than deleting it or creating another identity.
    return { success: false as const, pendingUserId: id,
      error: 'La cuenta se conserva sin confirmar el acceso. Reintenta o recarga Personal para completar su activación.' };
  }
}

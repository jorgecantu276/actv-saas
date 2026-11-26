export const participantFields = [
  ['nombre', 'Nombre', 'text', 100], ['apellido', 'Apellido', 'text', 100],
  ['telefono', 'Teléfono', 'tel', 30], ['telefono_emergencia', 'Teléfono de emergencia', 'tel', 30],
  ['talla_playera', 'Talla de playera', 'text', 30], ['fecha_nacimiento', 'Fecha de nacimiento', 'date', 10],
  ['genero', 'Género', 'text', 30], ['ciudad', 'Ciudad', 'text', 100],
  ['club', 'Club', 'text', 120], ['email', 'Correo del participante', 'email', 254],
] as const;

export type ParticipantField = typeof participantFields[number][0];
export type ParticipantData = Partial<Record<ParticipantField, string | null>>;
export type RegistrationConsent = { policy_revision?: number; notice_version?: string; notice_accepted?: boolean;
  waiver_version?: string; waiver_accepted?: boolean };
export type RegistrationPolicy = { required_fields: string[]; revision: number;
  notice_version: string | null; notice_text: string | null;
  waiver_version: string | null; waiver_text: string | null };
export type RegistrationSnapshot = { participant: ParticipantData;
  package?: { number?: number | null; name?: string | null; amount_minor?: number | null };
  event?: { id?: string; name?: string | null; date?: string | null; distance?: string | null };
  consent?: { status?: string; notice_version?: string | null; waiver_version?: string | null;
    accepted_at?: string | null; actor?: string | null };
  accepted_at?: string | null; channel?: string | null; policy_revision?: number | null };
export type RegistrationRecordData = { registration_id: string; event_id: string; revision: number;
  original: RegistrationSnapshot | null; effective: RegistrationSnapshot; provenance: string;
  can_correct: boolean; corrections: { request_id: string; revision: number; reason: string;
    actor: string; happened_at: string; before: RegistrationSnapshot; after: RegistrationSnapshot }[] };

export function consentFor(policy: RegistrationPolicy | null, notice: boolean, waiver: boolean): RegistrationConsent | undefined {
  if (!policy?.notice_version && !policy?.waiver_version) return undefined;
  return { policy_revision: policy.revision, ...(policy.notice_version ? { notice_version: policy.notice_version, notice_accepted: notice } : {}),
    ...(policy.waiver_version ? { waiver_version: policy.waiver_version, waiver_accepted: waiver } : {}) };
}

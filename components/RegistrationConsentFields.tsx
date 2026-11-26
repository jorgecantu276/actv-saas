'use client';
import type { RegistrationPolicy } from '../lib/registration-contract';

export default function RegistrationConsentFields({ policy, notice, waiver, onNotice, onWaiver, staff = false }: {
  policy: RegistrationPolicy | null; notice: boolean; waiver: boolean;
  onNotice: (value: boolean) => void; onWaiver: (value: boolean) => void; staff?: boolean;
}) {
  if (!policy?.notice_version && !policy?.waiver_version) return null;
  return <div className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-900">
    {([['notice', 'Aviso de privacidad', policy.notice_version, policy.notice_text, notice, onNotice],
      ['waiver', 'Condiciones de participación', policy.waiver_version, policy.waiver_text, waiver, onWaiver]] as const)
      .filter(([, , version]) => version).map(([key, label, version, text, checked, change]) => <section key={key}>
        <details><summary className="cursor-pointer font-semibold">{label} · versión {version}</summary><p className="mt-2 whitespace-pre-wrap">{text}</p></details>
        <label className="mt-2 flex items-start gap-2"><input type="checkbox" required checked={checked} onChange={event => change(event.target.checked)} />
          <span>{staff ? 'Mostré este documento y registro la aceptación comunicada por el participante.' : 'He leído este documento y registro mi aceptación para esta inscripción.'}</span></label>
      </section>)}
  </div>;
}

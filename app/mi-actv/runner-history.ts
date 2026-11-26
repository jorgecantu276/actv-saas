export type Registration = {
  event_id: string;
  event_name: string;
  event_date: string;
  folio: string;
  attended: boolean;
  personal: boolean;
  achievement_slug: string | null;
};

export const attendanceMilestones = [
  { count: 1, label: 'Primera salida' },
  { count: 3, label: 'Ya es costumbre' },
  { count: 5, label: 'Parte de la ruta' },
  { count: 10, label: 'Diez historias' },
] as const;

export function runnerHistory(registrations: Registration[], today: string) {
  const confirmed = registrations.filter((race) => race.personal && race.attended)
    .sort((a, b) => b.event_date.localeCompare(a.event_date));
  const attended = [...new Map(confirmed.map((race) => [race.event_id, race])).values()];
  const upcoming = registrations.filter((race) => race.event_date >= today && !(race.personal && race.attended))
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || Number(b.personal) - Number(a.personal));
  const otherPast = registrations.filter((race) => race.event_date < today && !(race.personal && race.attended))
    .sort((a, b) => b.event_date.localeCompare(a.event_date) || Number(b.personal) - Number(a.personal));
  return {
    attended,
    upcoming,
    otherPast,
    count: attended.length,
    nextMilestone: attendanceMilestones.find((milestone) => milestone.count > attended.length) ?? null,
  };
}

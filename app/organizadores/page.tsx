import type { Metadata } from 'next';
import Organizers from './organizers';

export const metadata: Metadata = {
  title: 'Organizadores | ACTV', referrer: 'no-referrer', robots: { index: false, follow: false },
};

export default async function OrganizersPage({ searchParams }: {
  searchParams: Promise<{ evento?: string | string[]; reanudar?: string | string[]; auth_error?: string | string[]; error_code?: string | string[] }>;
}) {
  const { evento, reanudar, auth_error, error_code } = await searchParams;
  const eventId = typeof evento === 'string' ? evento : '';
  return <Organizers key={eventId} initialEventId={eventId} shouldResume={reanudar === '1'} linkFailed={auth_error === '1' || typeof error_code === 'string'} />;
}

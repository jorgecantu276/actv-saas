import type { Metadata } from 'next';
import Organizers from './organizers';

export const metadata: Metadata = {
  title: 'Pagos para organizadores | ACTV', referrer: 'no-referrer', robots: { index: false, follow: false },
};

export default async function OrganizersPage({ searchParams }: {
  searchParams: Promise<{ evento?: string | string[]; reanudar?: string | string[] }>;
}) {
  const { evento, reanudar } = await searchParams;
  const eventId = typeof evento === 'string' ? evento : '';
  return <Organizers key={eventId} initialEventId={eventId} shouldResume={reanudar === '1'} />;
}

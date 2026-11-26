import type { Metadata } from 'next';
import EventOperations from '@/components/EventOperations';

export const metadata: Metadata = { title: 'Operaciones | ACTV', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ evento?: string }> }) {
  const params = await searchParams;
  const eventId = typeof params.evento === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(params.evento)
    ? params.evento : '';
  return <EventOperations initialEventId={eventId} />;
}

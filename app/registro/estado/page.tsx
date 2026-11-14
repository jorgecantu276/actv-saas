import type { Metadata } from 'next';
import Status from './status';

export const metadata: Metadata = {
  title: 'Estado de la inscripción | ACTV', referrer: 'no-referrer', robots: { index: false, follow: false },
};

export default async function OrderStatusPage({ searchParams }: {
  searchParams: Promise<{ orden?: string | string[]; cancelado?: string | string[] }>;
}) {
  const { orden, cancelado } = await searchParams;
  const orderId = typeof orden === 'string' ? orden : '';
  return <Status key={orderId} orderId={orderId} canceled={cancelado === '1'} />;
}

import type { Metadata } from 'next';
import Checkout from './checkout';

export const metadata: Metadata = { title: 'Inscripciones en línea | ACTV' };

export default async function RaceCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Checkout key={slug} slug={slug} />;
}

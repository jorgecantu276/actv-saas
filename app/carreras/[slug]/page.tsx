import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PublicSite, publicButton } from '../../_pagos/public-site';
import { legacyRacePages, wordpressSite } from '../../inicio/wordpress-content';
import Checkout from './checkout';

export const metadata: Metadata = { title: 'Inscripciones en línea | ACTV' };

async function checkoutAvailability(slug: string) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const endpoint = URL.parse('/functions/v1/actv-checkout', process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!key || !endpoint) return 'unavailable';

  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'event', slug }),
      cache: 'no-store',
      signal: AbortSignal.timeout(7_000),
    });
    if (result.status === 200) return 'open';
    if (result.status === 404 && (await result.json())?.error === 'event_not_found') return 'missing';
  } catch {
    return 'unavailable';
  }
  return 'unavailable';
}

export default async function RaceCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const legacyRace = legacyRacePages.find((race) => race.slug === slug);
  if (!legacyRace) return <Checkout key={slug} slug={slug} />;

  const availability = await checkoutAvailability(slug);
  if (availability === 'open') return <Checkout key={slug} slug={slug} />;

  const requestHeaders = await headers();
  const requestHost = (requestHeaders.get('x-forwarded-host') || requestHeaders.get('host'))?.split(',')[0].trim();
  const requestedHostname = requestHost && URL.parse(`https://${requestHost}`)?.hostname.replace(/^www\./, '');
  const racePath = `/carreras/${legacyRace.slug}/`;
  const previousPage = new URL(racePath, wordpressSite);
  const legacyLink = requestedHostname && previousPage.hostname.replace(/^www\./, '') !== requestedHostname
    ? previousPage.href : null;

  return (
    <PublicSite>
      <section className="mx-auto max-w-4xl px-6 pt-10 pb-20 sm:px-10">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">{legacyRace.title}</h1>
        {availability === 'missing'
          ? <p className="mt-5 text-lg">Esta carrera forma parte del archivo de ACTV.</p>
          : <p className="mt-5 text-lg" role="alert">No pudimos comprobar si las inscripciones están abiertas. Intenta de nuevo.</p>}
        <div className="mt-7 flex flex-wrap gap-4">
          {availability === 'unavailable' && <a href={racePath} className={publicButton}>Volver a intentar</a>}
          {legacyLink && <a href={legacyLink} className={publicButton}>Ver ficha original</a>}
          <Link href="/inicio#race-archive-title" className="self-center font-semibold underline underline-offset-4">Comunidad ACTV</Link>
        </div>
      </section>
    </PublicSite>
  );
}

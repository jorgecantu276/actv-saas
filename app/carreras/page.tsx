import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { PublicSite, raceDate } from '../_pagos/public-site';
import { loadPublicRaces, type PublicRace } from '../_pagos/public-races';
import { raceArchive } from '../inicio/wordpress-content';
import styles from './calendar.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Calendario de carreras | ACTV' };

const price = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const monthLabel = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayOfWeek = new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: 'UTC' });
const archivePhoto = raceArchive[0];

function groupByMonth(races: PublicRace[]) {
  const months = new Map<string, PublicRace[]>();
  for (const race of races) {
    const month = race.date.slice(0, 7);
    const entries = months.get(month);
    if (entries) entries.push(race);
    else months.set(month, [race]);
  }
  return months;
}

export default async function RacesPage() {
  const { races, unavailable } = await loadPublicRaces();
  return (
    <PublicSite active="/carreras">
      <div className={styles.page}>
        <h1 className={styles.title}>Calendario de carreras</h1>
        <div className={styles.layout}>
          <section aria-labelledby="upcoming-races">
            <h2 id="upcoming-races" className={styles.sectionTitle}>Próximas carreras</h2>
            {unavailable ? (
              <div className={styles.notice}>
                <p role="alert">No pudimos cargar las carreras.</p>
                <form action="/carreras" method="get">
                  <button type="submit" className={styles.textLink}>Volver a cargar</button>
                </form>
              </div>
            ) : races.length === 0 ? (
              <p className={styles.notice}>Aún no hay carreras con inscripciones abiertas.</p>
            ) : (
              <div className={styles.months}>
                {Array.from(groupByMonth(races), ([month, entries]) => (
                  <section key={month} aria-labelledby={'race-month-' + month}>
                    <h3 id={'race-month-' + month} className={styles.month}>
                      {monthLabel.format(new Date(month + '-01T12:00:00Z'))}
                    </h3>
                    <ul className={styles.races} role="list">
                      {entries.map((race) => (
                        <li key={race.event_id} className={styles.race}>
                          <time dateTime={race.date} className={styles.date}>
                            <span className="sr-only">{raceDate(race.date)}</span>
                            <span aria-hidden="true">{dayOfWeek.format(new Date(race.date + 'T12:00:00Z'))}</span>
                            <strong aria-hidden="true">{race.date.slice(8, 10)}</strong>
                          </time>
                          <div className={styles.raceDetails}>
                            <h4>{race.name}</h4>
                            {race.distance && race.distance !== 'Por confirmar' && <p>{race.distance}</p>}
                          </div>
                          <div className={styles.entry}>
                            {race.available > 0 ? (
                              <>
                                <span>Desde {price.format(race.price / 100)}</span>
                                <Link href={'/carreras/' + encodeURIComponent(race.slug)} className={styles.buy}>
                                  Comprar folio<span className="sr-only"> para {race.name}</span> <ArrowUpRight size={16} aria-hidden="true" />
                                </Link>
                              </>
                            ) : <span>Sin lugares disponibles</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
          <aside className={styles.archive} aria-labelledby="calendar-archive">
            <h2 id="calendar-archive" className={styles.sectionTitle}>Comunidad ACTV</h2>
            <figure>
              <div className={styles.photo}>
                <Image
                  src={archivePhoto.image}
                  alt={archivePhoto.alt}
                  fill
                  loading="eager"
                  sizes="(min-width: 944px) 16rem, (max-width: 336px) calc(100vw - 3rem), 18rem"
                  className="object-cover"
                />
              </div>
              <figcaption>{archivePhoto.title}</figcaption>
            </figure>
            <Link href="/inicio#race-archive-title" className={styles.textLink}>
              Ver archivo de carreras <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </aside>
        </div>
      </div>
    </PublicSite>
  );
}

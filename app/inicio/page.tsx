import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react';
import { PublicSite, raceDate } from '../_pagos/public-site';
import { loadPublicRaces } from '../_pagos/public-races';
import { RacePhoto } from '../_pagos/race-art';
import journey from '../_pagos/race-journey.module.css';
import { additionalRaceArticles, raceArchive, wordpressAccountLinks, wordpressPaths, wordpressResources, wordpressSite } from './wordpress-content';
import styles from './home.module.css';

export const metadata: Metadata = {
  title: 'ACTV | Carreras en Matamoros',
  description: 'Descubre carreras en Matamoros, compra tu folio y guarda tus asistencias en Mi ACTV.',
};

export const dynamic = 'force-dynamic';
const price = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });

export default async function PublicHome() {
  const { races } = await loadPublicRaces();
  const featured = races.find((race) => race.available > 0);
  const nextRaces = races.filter((race) => race.event_id !== featured?.event_id).slice(0, 3);
  return (
    <PublicSite active="/inicio">
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCanvas}>
          <RacePhoto priority sizes="100vw" className={styles.heroPhoto} />
          <div className={styles.heroCopy}>
            <p className={journey.kicker}>{featured ? 'Próxima carrera' : 'Matamoros, Tamaulipas'}</p>
            <h1 id="home-title">{featured?.name ?? 'Carreras en Matamoros'}</h1>
          </div>
        </div>
        <div className={styles.heroDetails}>
          <div className={styles.heroDetailsInner}>
            {featured ? (
              <div className={styles.raceFacts}>
                <time dateTime={featured.date}>{raceDate(featured.date)}</time>
                {featured.distance && featured.distance !== 'Por confirmar' && <span>{featured.distance}</span>}
                <span>Desde {price.format(featured.price / 100)} MXN</span>
              </div>
            ) : <p>Encuentra tu próxima salida y empieza tu historia en Mi ACTV.</p>}
            <Link className={journey.action} href={featured ? '/carreras/' + encodeURIComponent(featured.slug) : '/carreras'}>
              {featured ? 'Inscríbete' : 'Ver calendario'} <ArrowRight size={19} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {nextRaces.length > 0 && (
        <section className={styles.schedule} aria-labelledby="home-schedule">
          <div className={styles.sectionHead}>
            <h2 id="home-schedule">En el calendario</h2>
            <Link href="/carreras" className={styles.textLink}>Ver todas <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
          <ul>
            {nextRaces.map((race) => (
              <li key={race.event_id}>
                <time dateTime={race.date}>{raceDate(race.date)}</time>
                <span>{race.name}</span>
                {race.available > 0
                  ? <Link href={'/carreras/' + encodeURIComponent(race.slug)} aria-label={`Inscríbete a ${race.name}`}>Inscríbete <ArrowUpRight size={16} aria-hidden="true" /></Link>
                  : <span>Sin lugares</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.archive} aria-labelledby="race-archive-title">
        <div className={styles.sectionHead}>
          <h2 id="race-archive-title">Nuestra comunidad en la ruta</h2>
          <a className={styles.textLink} href={wordpressSite + wordpressPaths.archive}>Archivo de eventos <ArrowUpRight size={17} aria-hidden /></a>
        </div>
        <ul className={styles.stories}>
          {raceArchive.map((race, index) => (
            <li key={race.path} className={index === 0 ? styles.leadStory : undefined}>
              <article>
                <a href={wordpressSite + race.path} className={styles.storyLink}>
                  <Image src={race.image} alt={race.alt} width={768} height={512} sizes={index === 0 ? '(max-width: 760px) 100vw, 56vw' : '(max-width: 760px) 40vw, 19vw'} />
                  <div className={styles.storyCopy}>
                    <time dateTime={race.date}>{raceDate(race.date)}</time>
                    <h3>{race.title}</h3>
                    <ArrowUpRight size={18} aria-hidden />
                  </div>
                </a>
              </article>
            </li>
          ))}
        </ul>
        <details className={styles.otherStories}>
          <summary>Más crónicas de 2026 <ArrowDown size={17} aria-hidden /></summary>
          <ul>
            {additionalRaceArticles.map((race) => (
              <li key={race.path}>
                <a href={wordpressSite + race.path}>{race.title}</a>
                <time dateTime={race.date}>{raceDate(race.date)}</time>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Link href="/inicio" aria-label="Inicio de ACTV"><Image src="/icon-public.png" alt="" width={55} height={55} /></Link>
            <p>Matamoros, Tamaulipas</p>
          </div>
          <nav aria-label="Recursos para corredores">
            <h2>Corredores</h2>
            <Link href="/mi-actv">Mi pasaporte de carreras</Link>
            {wordpressResources.filter(({ href }) => href !== wordpressSite + wordpressPaths.services).map(({ href, title }) => (
              <a href={href} key={href}>{title}</a>
            ))}
          </nav>
          <nav aria-label="Recursos para organizadores">
            <h2>Organizadores</h2>
            <Link href="/organizadores">Publicar una carrera</Link>
            <a href={wordpressSite + wordpressPaths.services}>Servicios para eventos</a>
            <a href={wordpressSite + '/tienda/'}>Tienda ACTV</a>
          </nav>
          <details className={styles.legacy}>
            <summary>Cuenta del sitio anterior</summary>
            <ul>
              {wordpressAccountLinks.map((link) => (
                <li key={link.path}><a href={wordpressSite + link.path}>{link.title}</a></li>
              ))}
            </ul>
          </details>
        </div>
      </footer>
    </PublicSite>
  );
}

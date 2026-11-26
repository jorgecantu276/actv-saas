import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { actvDisplay } from './public-type';
import styles from './public-site.module.css';

const navigation = [
  { href: '/carreras', label: 'Carreras' },
  { href: '/inicio#race-archive-title', label: 'Comunidad' },
  { href: '/organizadores', label: 'Organizadores' },
] as const;

export function PublicSite({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className={actvDisplay.variable + ' ' + styles.site}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <Link className={styles.brand} href="/inicio" aria-label="Inicio de ACTV">
            <Image src="/icon-public.png" alt="" width={43} height={43} />
          </Link>
          <nav className={styles.navigation} aria-label="Navegación principal">
            {navigation.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={active === href ? 'page' : undefined}>{label}</Link>
            ))}
          </nav>
          <Link className={styles.account} href="/mi-actv" aria-current={active === '/mi-actv' ? 'page' : undefined}>
            Mi ACTV <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

const raceDateFormatter = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long', timeZone: 'UTC',
});

export function raceDate(date: string) {
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? raceDateFormatter.format(timestamp) : date;
}

export const publicButton = 'inline-flex w-fit items-center gap-3 bg-[#ff633e] px-5 py-3 text-sm font-bold text-[#181818] hover:bg-[#ff7859] focus-visible:outline-2 focus-visible:outline-offset-4';

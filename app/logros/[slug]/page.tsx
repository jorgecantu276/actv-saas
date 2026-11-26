import Link from 'next/link';
import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Award, ArrowUpRight } from 'lucide-react';
import { PublicSite, publicButton, raceDate } from '../../_pagos/public-site';

export const dynamic = 'force-dynamic';

const getAchievement = cache(async (slug: string) => {
  if (!/^[a-f0-9]{32}$/.test(slug)) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc('actv_public_achievement', { p_slug: slug });
  if (error) throw new Error('No se pudo consultar el logro.');
  if (typeof data?.event_name !== 'string' || typeof data?.event_date !== 'string') return null;
  return data as { event_name: string; event_date: string };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const achievement = await getAchievement((await params).slug);
  if (!achievement) return { title: 'Logro | ACTV', robots: { index: false, follow: false } };
  const title = 'Estuve en ' + achievement.event_name + ' | ACTV';
  const description = 'Asistencia registrada el ' + raceDate(achievement.event_date) + '.';
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description, type: 'website' }, twitter: { card: 'summary', title, description } };
}

export default async function AchievementPage({ params }: { params: Promise<{ slug: string }> }) {
  const achievement = await getAchievement((await params).slug);
  if (!achievement) notFound();
  return (
    <PublicSite>
      <section className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
        <div className="border border-[#d6d2c8] bg-[#202d29] px-7 py-12 text-white sm:px-14">
          <p className="text-xs font-bold tracking-[.14em] text-[#ff8c6c]">MI PASAPORTE / ACTV</p>
          <Award className="mt-9 text-[#ff8c6c]" size={46} aria-hidden="true" />
          <p className="mt-8 text-sm font-semibold text-[#ff8c6c]">Asistencia confirmada</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">Estuve en {achievement.event_name}</h1>
          <p className="mt-5 text-lg text-white/85">{raceDate(achievement.event_date)}</p>
          <Link href="/carreras" className={publicButton + ' mt-9'}>Encuentra tu próxima carrera <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
      </section>
    </PublicSite>
  );
}

import 'server-only';
import { createClient } from '@supabase/supabase-js';

export type PublicRace = {
  event_id: string;
  slug: string;
  name: string;
  date: string;
  distance: string | null;
  price: number;
  available: number;
};

export async function loadPublicRaces() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { races: [], unavailable: true };

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('actv_public_races', {
      p_live_mode: process.env.ACTV_PUBLIC_RACE_MODE === 'live',
    }).abortSignal(AbortSignal.timeout(3000));

    return { races: Array.isArray(data) ? data as PublicRace[] : [], unavailable: Boolean(error) };
  } catch {
    return { races: [], unavailable: true };
  }
}

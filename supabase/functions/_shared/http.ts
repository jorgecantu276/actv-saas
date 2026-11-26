import { createClient } from 'npm:@supabase/supabase-js@2.103.3';

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function env(name: string): string {
  const result = Deno.env.get(name);
  if (!result) throw new HttpError(503, 'payment_configuration_required');
  return result;
}

export function appOrigin(): URL {
  const url = new URL(env('ACTV_APP_URL'));
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && !liveMode() && url.protocol === 'http:')) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new HttpError(503, 'payment_configuration_required');
  }
  return url;
}

export function liveMode(): boolean {
  const mode = env('ACTV_STRIPE_MODE');
  if (mode !== 'test' && mode !== 'live') throw new HttpError(503, 'payment_configuration_required');
  return mode === 'live';
}

export function db() {
  const secret = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = secret ? JSON.parse(secret).default : null;
  return createClient(env('SUPABASE_URL'), key || env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (!error) return data as T;
  if (error.code === '42501') throw new HttpError(403, 'access_denied');
  if (error.code === 'P0002') throw new HttpError(404, 'record_not_found');
  if (error.code === '22023') throw new HttpError(400, 'invalid_order');
  if (error.code === '23505' || error.code === '23514' || error.code === 'P0001') {
    throw new HttpError(409, 'order_conflict_or_unavailable');
  }
  console.error(JSON.stringify({ component: name, code: error.code }));
  throw new HttpError(503, 'database_temporarily_unavailable');
}

export async function operator(request: Request): Promise<string> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) throw new HttpError(401, 'sign_in_required');
  const { data, error } = await db().auth.getUser(bearer);
  if (error || !data.user) throw new HttpError(401, 'sign_in_required');
  return data.user.id;
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await boundedBody(request, 32_768);
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // Use the same response for malformed JSON and unsupported payload shape.
  }
  throw new HttpError(400, 'invalid_request');
}

export async function boundedBody(request: Request, limit: number): Promise<string> {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new HttpError(413, 'request_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function uuid(value: unknown, code = 'invalid_request'): string {
  if (typeof value !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) {
    throw new HttpError(400, code);
  }
  return value;
}

export function field(value: unknown, max: number, required = true): string {
  if (!required && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, 'invalid_request');
  }
  return value.trim();
}

export function buyerEmail(value: unknown): string {
  const email = field(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new HttpError(400, 'invalid_email');
  return email;
}

export function trustedOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === appOrigin().origin) return origin;
  const staffOrigin = Deno.env.get('ACTV_STAFF_ORIGIN');
  if (staffOrigin && origin === new URL(staffOrigin).origin) return origin;
  throw new HttpError(403, 'origin_denied');
}

export function handler(name: string, run: (request: Request) => Promise<unknown>, browser = false) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'cache-control': 'no-store', vary: 'Origin' });
    try {
      if (browser) {
        const origin = trustedOrigin(request);
        if (origin) headers.set('access-control-allow-origin', origin);
        if (request.method === 'OPTIONS') {
          headers.set('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info');
          headers.set('access-control-allow-methods', 'POST, OPTIONS');
          return new Response(null, { status: 204, headers });
        }
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      return Response.json(await run(request), { headers });
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.code }, { status: error.status, headers });
      }
      const kind = error instanceof Error ? error.name : typeof error;
      console.error(JSON.stringify({ component: name, kind }));
      return Response.json({ error: 'payment_operation_unavailable' }, { status: 503, headers });
    }
  };
}

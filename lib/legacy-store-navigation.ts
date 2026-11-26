import { wordpressOrigin as storeOrigin } from './wordpress-origin.ts';

export function legacyStoreRoute(section: 'carrito' | 'finalizar-compra' | 'ajustes') {
  return async function GET(request: Request, context: { params: Promise<{ parts?: string[] }> }) {
    const source = new URL(request.url);
    if (source.origin === storeOrigin) return new Response('Ruta de tienda no configurada.', { status: 503 });
    const { parts = [] } = await context.params;
    if (parts.some((part) => part === '.' || part === '..' || /[\/\\\u0000-\u001f]/.test(part))) {
      return new Response('Ruta de tienda inválida.', { status: 400 });
    }
    const path = [section, ...parts].map(encodeURIComponent).join('/');
    const destination = new URL('/' + path + '/', storeOrigin);
    const passwordRecovery = section === 'ajustes' && parts[0] === 'lost-password';
    for (const [key, value] of source.searchParams) {
      if (/^(?:utm_[a-z_]+|key|order|pay_for_order)$/i.test(key) ||
        (passwordRecovery && /^(?:id|login|action|show-reset-form)$/.test(key))) destination.searchParams.append(key, value);
    }
    return new Response(null, { status: 302, headers: {
      Location: destination.href, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    } });
  };
}


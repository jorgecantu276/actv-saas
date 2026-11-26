export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(
    'ACTV | Mercado Pago\n\nEsta página recibe el regreso de Mercado Pago para la vinculación de prueba. Continúa en la terminal donde iniciaste la prueba.\n',
    {
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'content-type': 'text/plain; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    },
  );
}

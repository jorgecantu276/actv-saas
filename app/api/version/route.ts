import identity from '../../../lib/release-identity.generated.json';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(identity, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

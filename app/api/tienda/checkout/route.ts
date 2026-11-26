import { NextResponse } from 'next/server';

// Merchandise continues to use the existing WordPress store.
function unavailable() {
  return NextResponse.json(
    { error: 'Usa la tienda ACTV existente.', storeUrl: 'https://actv.mx/tienda/' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = unavailable;
export const POST = unavailable;

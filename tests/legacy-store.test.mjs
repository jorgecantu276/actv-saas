import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyStoreRoute } from '../lib/legacy-store-navigation.ts';

test('existing-store recovery preserves only approved query values and never caches secrets', async () => {
  const response = await legacyStoreRoute('ajustes')(new Request('https://race.invalid/ajustes/lost-password/?key=synthetic&login=runner&token=drop'), {
    params: Promise.resolve({ parts: ['lost-password'] }),
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://actv.mx');
  assert.equal(location.searchParams.get('key'), 'synthetic');
  assert.equal(location.searchParams.get('login'), 'runner');
  assert.equal(location.searchParams.has('token'), false);
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('existing-store adapter rejects traversal and a redirect loop', async () => {
  const handler = legacyStoreRoute('carrito');
  assert.equal((await handler(new Request('https://race.invalid/carrito/'), { params: Promise.resolve({ parts: ['..'] }) })).status, 400);
  assert.equal((await handler(new Request('https://actv.mx/carrito/'), { params: Promise.resolve({}) })).status, 503);
});

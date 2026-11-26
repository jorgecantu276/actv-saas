import assert from 'node:assert/strict';
import { mercadoPagoConfig, mercadoPagoEnabled } from './mercado-pago-checkout.ts';

Deno.test('supported candidate cannot enable the unfinished provider from environment settings', () => {
  const settings = {
    ACTV_STRIPE_MODE: 'test', ACTV_MP_TEST_APP_ID: '1234',
    ACTV_MP_TEST_SELLER_TOKEN: 'synthetic', ACTV_MP_TEST_COLLECTOR_ID: '1234',
    ACTV_MP_TEST_WEBHOOK_SECRET: 'synthetic',
    ACTV_MP_TEST_WEBHOOK_URL: 'https://fixture.invalid/webhook',
    ACTV_MP_TEST_RETURN_URL: 'https://fixture.invalid/return',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(settings)) Deno.env.set(key, value);
    assert.equal(mercadoPagoEnabled(), false);
    assert.throws(() => mercadoPagoConfig(), /mercadopago_not_available/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});

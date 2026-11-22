import assert from 'node:assert/strict';
import test from 'node:test';
import { LifetimeLicense, checkInterval, offlineGrace } from '../src/lifetimeLicense.ts';

const productId = 'pdt_example';
const key = 'demo-license';
const instanceId = 'lki_123';
const activation = { id: instanceId, product: { product_id: productId }, customer: { email: 'example@example.com' } };
const instance = { license_key: key, license_key_instance_id: instanceId };

function fixture() {
  let now = 1_800_000_000_000;
  let stored = null;
  const responses = [];
  const requests = [];
  function app() {
    return new LifetimeLicense({
      productId, read: async () => stored, write: async (record) => { stored = record; }, now: () => now,
      fetch: async (url, options) => {
        assert.equal(new URL(url).origin, 'https://test.dodopayments.com');
        assert.equal(options.method, 'POST');
        requests.push([new URL(url).pathname, JSON.parse(options.body)]);
        assert.notEqual(responses.length, 0, 'unexpected licensing request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    });
  }
  return { app, requests, responses, stored: () => JSON.parse(stored), advance: (ms) => { now += ms; } };
}

test('validates the new instance before unlocking, persists only licensing data, and survives restart', async () => {
  const f = fixture();
  const app = f.app();
  await app.foreground();
  f.responses.push(Response.json(activation, { status: 201 }), Response.json({ valid: true }));
  await app.redeem('  ' + key + '  ');
  assert.equal(app.view().status, 'active');
  assert.deepEqual(f.requests, [
    ['/licenses/activate', { license_key: key, name: 'Nimby Android ' + (1_800_000_000_000).toString(36) }],
    ['/licenses/validate', instance],
  ]);
  assert.deepEqual(Object.keys(f.stored()).sort(), ['instanceId', 'key', 'lastAutomaticCheckAt', 'productId', 'verifiedAt']);
  const restarted = f.app();
  await restarted.foreground();
  assert.equal(restarted.view().status, 'active');
  assert.equal(f.requests.length, 2);
});

test('rejects a different product and releases the unexpected activation', async () => {
  const f = fixture();
  const app = f.app();
  await app.foreground();
  f.responses.push(Response.json({ ...activation, product: { product_id: 'pdt_other' } }), new Response(null, { status: 204 }));
  await app.redeem(key);
  assert.equal(app.view().status, 'free');
  assert.equal(f.stored(), null);
  assert.deepEqual(f.requests[1], ['/licenses/deactivate', instance]);
  f.responses.push(new Response(null, { status: 422 }));
  await app.redeem(key);
  assert.equal(app.view().status, 'free');
  assert.match(app.view().message, /no available activation/);
});

test('validation failure retains the pending activation and retries without creating a second instance', async () => {
  const f = fixture();
  const app = f.app();
  await app.foreground();
  f.responses.push(Response.json(activation), new Error('network down'));
  await app.redeem(key);
  assert.equal(app.view().status, 'verify');
  assert.equal(f.stored().instanceId, instanceId);
  f.responses.push(Response.json({ valid: true }));
  await app.check();
  assert.equal(app.view().status, 'active');
  assert.deepEqual(f.requests.map(([path]) => path), ['/licenses/activate', '/licenses/validate', '/licenses/validate']);
});

test('throttles automatic checks across restarts and locks at the offline deadline', async () => {
  const f = fixture();
  const app = f.app();
  await app.foreground();
  f.responses.push(Response.json(activation), Response.json({ valid: true }));
  await app.redeem(key);
  f.advance(checkInterval);
  f.responses.push(new Error('network down'));
  await app.foreground();
  const restarted = f.app();
  await restarted.foreground();
  assert.equal(f.requests.length, 3);
  assert.equal(restarted.view().status, 'active');
  f.advance(offlineGrace - checkInterval);
  assert.equal(restarted.view().status, 'verify');
});

test('invalid validation locks immediately and release clears the local activation only after success', async () => {
  const f = fixture();
  const app = f.app();
  await app.foreground();
  f.responses.push(Response.json(activation), Response.json({ valid: true }), Response.json({ valid: false }));
  await app.redeem(key);
  await app.check();
  assert.equal(app.view().status, 'verify');
  f.responses.push(new Error('network down'));
  await app.release();
  assert.equal(f.stored().instanceId, instanceId);
  f.responses.push(new Response(null, { status: 204 }));
  await app.release();
  assert.equal(app.view().status, 'free');
  assert.equal(f.stored(), null);
});

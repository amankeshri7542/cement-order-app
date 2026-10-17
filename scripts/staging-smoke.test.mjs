/* global AbortSignal, Headers, Response */
import assert from 'node:assert/strict';
import test from 'node:test';
import { stagingOrigins, stagingSmoke } from './staging-smoke.mjs';

const env = {
  STAGING_API_ORIGIN: 'https://api.staging.shivcement.in',
  STAGING_SHOP_ORIGIN: 'https://shop.staging.shivcement.in',
  STAGING_ADMIN_ORIGIN: 'https://admin.staging.shivcement.in',
};
const origins = stagingOrigins(env);

test('staging smoke refuses placeholders, credentials, paths and unrelated cookie sites before requests', () => {
  for (const value of [
    undefined,
    '',
    'http://api.staging.shivcement.in',
    'https://api.staging.example.invalid',
    'https://api.example.com',
    'https://localhost',
    'https://api.staging.shivcement.in/api/v1',
    'https://api.staging.shivcement.in/',
    'https://user:secret@api.staging.shivcement.in',
    'https://api.staging.shivcement.in?key=secret',
    'https://api.staging.shivcement.in:8443',
  ])
    assert.throws(() => stagingOrigins({ ...env, STAGING_API_ORIGIN: value }), /API_ORIGIN/);
  assert.throws(() => stagingOrigins({ ...env, STAGING_SHOP_ORIGIN: origins.api }), /sibling/);
  assert.throws(
    () => stagingOrigins({ ...env, STAGING_SHOP_ORIGIN: 'https://shop.other.in' }),
    /sibling/,
  );
});

function fixture(change = () => {}) {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    const headers = new Headers();
    let body;
    if (url.endsWith('/health/live')) body = { status: 'ok' };
    else if (url.endsWith('/health/ready')) body = { status: 'ready' };
    else if (url.endsWith('/store')) {
      body = { onlinePaymentsAvailable: false };
      headers.set('access-control-allow-origin', options.headers.Origin);
      headers.set('access-control-allow-credentials', 'true');
    } else if (url.includes('/products?')) body = { items: [{ id: 'test-cement' }] };
    else {
      body = '<title>Privacy · Shiv Cement Store</title>Store desk';
      headers.set('content-type', 'text/html');
      headers.set(
        'content-security-policy',
        `script-src 'nonce-fixture' 'strict-dynamic'; connect-src ${origins.api}; frame-ancestors 'none'`,
      );
      headers.set('strict-transport-security', 'max-age=31536000');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('cache-control', 'no-store');
      headers.set('x-shiv-app', 'storefront');
    }
    const result = { status: 200, headers, body };
    change(result, url);
    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      result,
    );
  };
  return { request, requests };
}

test('staging smoke checks the real health contract, both CORS origins, catalogue and public policy routes using GET only', async () => {
  const { request, requests } = fixture();
  assert.equal((await stagingSmoke(origins, request)).length, 9);
  assert.equal(requests.length, 9);
  for (const { options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.credentials, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.ok(requests.some(({ url }) => url === `${origins.admin}/delete-account`));
});

test('readiness failures, enabled payments, empty catalogue and weakened headers fail the gate', async () => {
  for (const change of [
    (r, url) => {
      if (url.endsWith('/health/ready')) r.status = 503;
    },
    (r, url) => {
      if (url.endsWith('/health/ready')) r.body = { status: 'ok' };
    },
    (r, url) => {
      if (url.endsWith('/store')) r.body.onlinePaymentsAvailable = true;
    },
    (r, url) => {
      if (url.endsWith('/store')) r.headers.set('access-control-allow-origin', '*');
    },
    (r, url) => {
      if (url.includes('/products?')) r.body.items = [];
    },
    (r) => {
      r.headers.delete('strict-transport-security');
    },
    (r) => {
      r.headers.set('content-security-policy', "script-src 'unsafe-inline'");
    },
    (r) => {
      r.headers.set('cache-control', 'public');
    },
    (r) => {
      r.headers.set('x-shiv-app', 'other-site');
    },
  ])
    await assert.rejects(stagingSmoke(origins, fixture(change).request));
});

/* global AbortSignal */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function stagingOrigins(env) {
  const origins = {};
  for (const name of ['API', 'SHOP', 'ADMIN']) {
    const key = `STAGING_${name}_ORIGIN`;
    let url;
    try {
      url = new URL(env[key]);
    } catch {
      throw new Error(`${key} must be a configured HTTPS origin.`);
    }
    assert(
      url.origin === env[key] &&
        url.protocol === 'https:' &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/.test(url.hostname) &&
        !/(^|\.)(localhost|invalid|test|example)$|(^|\.)example\.(com|net|org)$/.test(url.hostname),
      `${key} must be a real canonical HTTPS origin without credentials or paths.`,
    );
    origins[name.toLowerCase()] = url.origin;
  }
  const parents = Object.values(origins).map((origin) =>
    new URL(origin).hostname.split('.').slice(1).join('.'),
  );
  assert(
    new Set(parents).size === 1 && new Set(Object.values(origins)).size === 3,
    'API, shop and admin must use distinct sibling subdomains for cookie sign-in.',
  );
  return origins;
}

export async function stagingSmoke(origins, request = fetch) {
  const passed = [];
  async function get(name, url, headers = {}) {
    const response = await request(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, `${name}: expected HTTP 200`);
    return response;
  }
  for (const status of ['live', 'ready']) {
    const response = await get(`API ${status}`, `${origins.api}/api/v1/health/${status}`);
    assert.equal(
      (await response.json()).status,
      status === 'live' ? 'ok' : 'ready',
      `API ${status}: wrong health identity`,
    );
    passed.push(`API ${status}`);
  }
  for (const name of ['shop', 'admin']) {
    const response = await get(`${name} CORS`, `${origins.api}/api/v1/store`, {
      Origin: origins[name],
    });
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      origins[name],
      `${name}: wrong CORS origin`,
    );
    assert.equal(
      response.headers.get('access-control-allow-credentials'),
      'true',
      `${name}: cookies not allowed`,
    );
    assert.equal(
      (await response.json()).onlinePaymentsAvailable,
      false,
      'Online payments must remain disabled for staging',
    );
    passed.push(`${name} credentialed CORS; online payments disabled`);
  }
  const catalogue = await (await get('catalogue', `${origins.api}/api/v1/products?limit=1`)).json();
  assert(
    Array.isArray(catalogue.items) && catalogue.items.length > 0,
    'Configure at least one TEST product before the demo',
  );
  passed.push('catalogue has a product');
  for (const [name, path] of [
    ['shop', '/'],
    ['admin', '/'],
    ['admin', '/privacy'],
    ['admin', '/delete-account'],
  ]) {
    const response = await get(`${name}${path}`, `${origins[name]}${path}`);
    assert(response.headers.get('content-type')?.includes('text/html'), `${name}${path}: not HTML`);
    const csp = response.headers.get('content-security-policy') || '';
    const scripts = csp.split(';').find((rule) => rule.trim().startsWith('script-src ')) || '';
    assert(
      scripts.includes("'nonce-") && !/unsafe-inline|unsafe-eval/.test(scripts),
      `${name}${path}: unsafe script policy`,
    );
    assert(
      csp.includes(origins.api) && csp.includes("frame-ancestors 'none'"),
      `${name}${path}: incorrect CSP`,
    );
    assert(
      response.headers.get('strict-transport-security')?.includes('max-age='),
      `${name}${path}: missing HSTS`,
    );
    assert.equal(
      response.headers.get('x-content-type-options'),
      'nosniff',
      `${name}${path}: missing nosniff`,
    );
    assert(
      response.headers.get('cache-control')?.includes('no-store'),
      `${name}${path}: missing no-store`,
    );
    const html = await response.text();
    assert(html.includes('Shiv Cement Store'), `${name}${path}: wrong application`);
    if (name === 'shop')
      assert.equal(response.headers.get('x-shiv-app'), 'storefront', 'Wrong storefront identity');
    if (name === 'admin' && path === '/')
      assert(html.includes('Store desk'), 'Wrong owner desk identity');
    passed.push(`${name}${path} identity and security headers`);
  }
  return passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const checks = await stagingSmoke(stagingOrigins(process.env));
    console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
  } catch (error) {
    console.error(`Staging smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}

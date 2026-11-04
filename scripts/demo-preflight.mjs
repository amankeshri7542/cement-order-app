/* global AbortSignal */
// Read-only checks before the family review: is the API up, is the sample catalogue sellable,
// does the practice pincode deliver, are payments off, and do the website and desk send their
// security headers. Only GET requests, no cookies or tokens; nothing is written.
//
//   node scripts/demo-preflight.mjs [apiBase] [--site <url>] [--desk <url>]
//
// apiBase defaults to http://localhost:4000/api/v1. Exits non-zero when any check fails.
import { pathToFileURL } from 'node:url';
import { PRACTICE_PINCODE } from './demo-lib.mjs';

export const DEFAULT_API = 'http://localhost:4000/api/v1';
const version = /^\d+\.\d+\.\d+$/;
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export function preflightArgs(argv) {
  const options = { api: DEFAULT_API, site: '', desk: '' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].match(/^--(site|desk)(?:=(.*))?$/);
    if (flag) options[flag[1]] = flag[2] ?? argv[++i] ?? '';
    else if (argv[i].startsWith('--')) throw new Error(`Unknown option ${argv[i]}`);
    else options.api = argv[i];
  }
  for (const key of ['api', 'site', 'desk']) {
    if (!options[key]) continue;
    const url = new URL(options[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error(`${key} must be an http(s) URL without credentials.`);
    options[key] = url.href.replace(/\/$/, '');
  }
  return options;
}

export async function preflight({ api, site = '', desk = '' }, request = fetch) {
  const rows = [];
  const add = (status, check, detail = '') => rows.push({ status, check, detail });
  async function get(url, headers = {}) {
    const response = await request(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return response;
  }
  // One check; a thrown error or a false result is a FAIL with the reason.
  async function check(name, run) {
    try {
      const result = await run();
      if (Array.isArray(result)) add(result[0], name, result[1]);
      else add('PASS', name, result || '');
    } catch (error) {
      add('FAIL', name, error instanceof Error ? error.message : String(error));
    }
  }
  const json = async (path, headers) => (await get(`${api}${path}`, headers)).json();

  await check('API live', async () => {
    const response = await get(`${api}/health/live`);
    if ((await response.json()).status !== 'ok') throw new Error('unexpected health reply');
    if (response.headers.get('x-content-type-options') !== 'nosniff')
      return ['WARN', 'up, but nosniff header missing'];
  });
  await check('API ready (database)', async () => {
    if ((await json('/health/ready')).status !== 'ready') throw new Error('not ready');
  });
  await check('Catalogue: products with unit and price', async () => {
    const items = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const body = await json(`/products?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
      items.push(...body.items);
      if (!body.nextCursor) break;
      cursor = encodeURIComponent(body.nextCursor);
    }
    if (!items.length) throw new Error('no products; run "npm run demo -- prepare"');
    const broken = items.filter(
      (p) =>
        !String(p.unit || '').trim() || !Number.isSafeInteger(p.pricePaise) || p.pricePaise <= 0,
    );
    if (broken.length)
      throw new Error(
        `${broken.length} without unit or price: ${broken
          .slice(0, 3)
          .map((p) => p.name)
          .join(', ')}`,
      );
    const noHindi = items.filter((p) => 'nameHi' in p && !String(p.nameHi || '').trim());
    if (noHindi.length)
      return ['WARN', `${items.length} products; ${noHindi.length} without a Hindi name`];
    return `${items.length} products`;
  });
  await check(`Delivery to ${PRACTICE_PINCODE}`, async () => {
    const body = await json(`/delivery/${PRACTICE_PINCODE}`);
    if (!body.serviceable || !body.zone) throw new Error('no active delivery zone');
    return `${body.zone.name}: fee ₹${body.zone.deliveryFeePaise / 100}`;
  });
  const store = await json('/store').catch(() => null);
  await check('Online payments off', async () => {
    if (!store) throw new Error('store settings unavailable');
    if (store.onlinePaymentsAvailable !== false) throw new Error('online payments are available');
    return 'cash on delivery only';
  });
  const config = await json('/client-config').catch(() => null);
  await check('OTP mode', async () => {
    // Not every API build reports it; then the operator confirms OTP_PROVIDER on the server.
    const mode = config?.otpMode ?? config?.otp?.mode ?? store?.otpMode;
    if (!mode) return ['WARN', 'not reported by the API; confirm OTP_PROVIDER on the server'];
    return ['INFO', String(mode)];
  });
  await check('Android versions', async () => {
    const android = config?.android;
    if (!android) throw new Error('client-config unavailable');
    const { minimumVersion: min, latestVersion: latest, storeUrl } = android;
    if (!version.test(min || '') || !version.test(latest || ''))
      throw new Error('versions must look like 1.2.3');
    if (compare(min, latest) > 0) throw new Error(`minimum ${min} is above latest ${latest}`);
    if (!String(storeUrl || '').startsWith('https://')) throw new Error('store URL is not HTTPS');
    return `minimum ${min}, latest ${latest}`;
  });

  for (const [name, origin, identity] of [
    [
      'Website',
      site,
      (r, html) =>
        r.headers.get('x-shiv-app') === 'storefront' || html.includes('Shiv Cement Store'),
    ],
    ['Owner desk', desk, (_r, html) => html.includes('Store desk')],
  ]) {
    if (!origin) {
      add('SKIP', `${name} headers`, `pass --${name === 'Website' ? 'site' : 'desk'} <url>`);
      continue;
    }
    const allowed = new URL(origin).origin;
    await check(`${name} CORS`, async () => {
      const response = await get(`${api}/store`, { Origin: allowed });
      if (response.headers.get('access-control-allow-origin') !== allowed)
        throw new Error('API does not allow this origin');
      if (response.headers.get('access-control-allow-credentials') !== 'true')
        throw new Error('cookies not allowed');
    });
    await check(`${name} headers`, async () => {
      const response = await get(origin);
      if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('not HTML');
      const csp = response.headers.get('content-security-policy') || '';
      const scripts = csp.split(';').find((rule) => rule.trim().startsWith('script-src ')) || '';
      if (!scripts.includes("'nonce-") || /unsafe-inline|unsafe-eval/.test(scripts))
        throw new Error('unsafe script policy');
      if (!csp.includes("frame-ancestors 'none'")) throw new Error('page can be framed');
      if (response.headers.get('x-content-type-options') !== 'nosniff')
        throw new Error('nosniff missing');
      if (origin.startsWith('https:') && !response.headers.get('strict-transport-security'))
        throw new Error('HSTS missing');
      if (!identity(response, await response.text())) throw new Error('wrong application');
    });
  }
  return rows;
}

export function table(rows) {
  const width = Math.max(...rows.map((r) => r.check.length));
  return rows.map((r) => `${r.status.padEnd(5)} ${r.check.padEnd(width)}  ${r.detail}`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = preflightArgs(process.argv.slice(2));
    console.log(`Demo preflight against ${options.api}\n`);
    const rows = await preflight(options);
    console.log(table(rows));
    const failed = rows.filter((r) => r.status === 'FAIL').length;
    console.log(failed ? `\nFAIL: ${failed} check(s) failed.` : '\nPASS: ready for the demo.');
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`Demo preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

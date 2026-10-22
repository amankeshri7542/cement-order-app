#!/usr/bin/env node
/* global AbortSignal, performance */
// Live smoke/acceptance test for a deployed Shiv Cement Store demo (DEMO_MODE=true, mock OTP).
// Plain Node 22, global fetch only. It creates a fresh customer each run, so it can be re-run
// against the same demo database. Nothing secret is printed: the staff code is read from the
// environment, sent only to the API's verify endpoint and scrubbed from every note.
//
//   API_ORIGIN=https://api-x.development.catalystappsail.in \
//   ADMIN_ORIGIN=https://admin-x... SHOP_ORIGIN=https://shop-x... APP_ORIGIN=https://app-x... \
//   DEMO_ADMIN_PHONE=+919000000001 DEMO_STAFF_CODE=... \
//   REPORT_PATH=.local/demo/live-test.json node scripts/catalyst-demo/live-test.mjs
//
// VIA_FRONTEND=1 sends customer and staff calls to <their origin>/api/v1, as the browsers do on
// Catalyst (each frontend proxies the API because the gateway swallows CORS preflights).
// Optional: CUSTOMER_ORIGIN (defaults to APP_ORIGIN, then SHOP_ORIGIN), REQUEST_GAP_MS (default
// 650, keeps the run far below the API's 120 requests/minute/IP throttle).
// Note: each run requests two sign-in codes. The API allows 5 codes per phone per hour (30 s
// apart; check 6 waits once) and 10 per IP per 10 minutes, so about 5 runs fit in an hour.
import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const env = (key) => (process.env[key] || '').trim();
const originOf = (key) => {
  const value = env(key).replace(/\/+$/, '');
  if (!value) return '';
  const url = new URL(value);
  if (url.origin !== value) throw new Error(`${key} must be a bare origin such as https://host`);
  return value;
};
const API = originOf('API_ORIGIN');
const VIA_FRONTEND = process.env.VIA_FRONTEND === '1';
const ADMIN_ORIGIN = originOf('ADMIN_ORIGIN');
const SHOP_ORIGIN = originOf('SHOP_ORIGIN');
const APP_ORIGIN = originOf('APP_ORIGIN');
const CUSTOMER_ORIGIN = originOf('CUSTOMER_ORIGIN') || APP_ORIGIN || SHOP_ORIGIN;
const ADMIN_PHONE = env('DEMO_ADMIN_PHONE');
const STAFF_CODE = env('DEMO_STAFF_CODE');
const GAP = Number(env('REQUEST_GAP_MS') || 650);
const missing = [
  !API && 'API_ORIGIN',
  !ADMIN_ORIGIN && 'ADMIN_ORIGIN',
  !CUSTOMER_ORIGIN && 'APP_ORIGIN or SHOP_ORIGIN',
  !/^\+91[6-9]\d{9}$/.test(ADMIN_PHONE) && 'DEMO_ADMIN_PHONE (+91XXXXXXXXXX)',
  !/^\d{6}$/.test(STAFF_CODE) && 'DEMO_STAFF_CODE (6 digits)',
].filter(Boolean);
if (missing.length) {
  console.error(`Missing or invalid environment: ${missing.join(', ')}`);
  process.exit(2);
}
const HTTPS = API.startsWith('https://');
const codePattern = new RegExp(`(?<![0-9A-Za-z])${STAFF_CODE}(?![0-9A-Za-z])`);
const scrub = (text) => String(text).split(STAFF_CODE).join('******');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- HTTP with per-actor cookie jars, pacing and a secret-leak scan ----------
const stats = { requests: 0, firstMs: null, leaks: [], startedAt: new Date().toISOString() };
let lastCall = 0;
let current = null; // the running check, for network-time accounting
async function pace() {
  const wait = lastCall + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}
// Other secrets present in the environment (secrets.env is sourced for the run) and the
// credentials the Catalyst gateway injects into requests must never come back either.
const otherSecrets = ['OTP_HASH_SECRET', 'RUNTIME_DB_PASSWORD']
  .map((key) => process.env[key])
  .filter((value) => value && value.length >= 16);
const gatewayCredential = /x-zc-(project-secret-key|admin-cred|user-cred)|\b1001\.[0-9a-f]{32}\./i;
function scan(where, text) {
  if (!text) return;
  if (codePattern.test(text)) stats.leaks.push(where);
  if (otherSecrets.some((value) => text.includes(value)) || gatewayCredential.test(text))
    stats.leaks.push(`${where} (secret or gateway credential)`);
}
class Actor {
  constructor(name, origin) {
    this.name = name;
    this.origin = origin;
    this.jar = new Map();
    this.setCookies = [];
  }
  absorb(headers) {
    const list = headers.getSetCookie?.() || [];
    if (list.length) this.setCookies = list;
    for (const line of list) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expires = attrs.find((a) => /^\s*expires=/i.test(a));
      const maxAge = attrs.find((a) => /^\s*max-age=/i.test(a));
      const dead =
        !value ||
        (maxAge && Number(maxAge.split('=')[1]) <= 0) ||
        (expires && new Date(expires.split('=')[1]).getTime() < Date.now());
      if (dead) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  async call(method, path, { body, headers = {}, binary = false, origin, retried = false } = {}) {
    await pace();
    const sendOrigin = origin === undefined ? this.origin : origin;
    const h = { Accept: 'application/json', 'User-Agent': 'shiv-live-test/1.0', ...headers };
    if (sendOrigin) h.Origin = sendOrigin;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.jar.size) h.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const started = performance.now();
    let res;
    try {
      res = await fetch(`${VIA_FRONTEND && this.origin ? this.origin : API}/api/v1${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(45000),
      });
    } finally {
      stats.requests++;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Math.round(performance.now() - started);
    if (stats.firstMs === null) stats.firstMs = ms;
    if (current) current.netMs += ms;
    this.absorb(res.headers);
    const text = binary ? '' : buf.toString('utf8');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON bodies (HTML error pages) are kept as text.
    }
    scan(`${method} ${path.split('?')[0]}`, text);
    scan(`${method} ${path.split('?')[0]} (headers)`, [...res.headers].flat().join('\n'));
    const out = { status: res.status, headers: res.headers, text, json, buf, ms };
    // Throttled requests never reach a handler, so one delayed retry is safe.
    const code = json?.error?.code;
    if (res.status === 429 && !retried && !/LIMIT|DEMAND|BUSY/.test(code || '')) {
      const after = Math.min(Number(res.headers.get('retry-after')) || 20, 60);
      await sleep(after * 1000);
      return this.call(method, path, { body, headers, binary, origin, retried: true });
    }
    return out;
  }
}
const why = (r) =>
  `HTTP ${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}${
    r.json?.error?.message ? `: ${String(r.json.error.message).slice(0, 140)}` : ''
  }`;
function need(condition, message) {
  if (!condition) throw new Error(message);
}
function expectStatus(r, statuses, label) {
  const list = [statuses].flat();
  need(list.includes(r.status), `${label}: ${why(r)}`);
  return r.json;
}

// ---------- check runner ----------
const results = [];
class Skip extends Error {}
async function check(id, name, fn, { requires = [] } = {}) {
  const blocked = requires.filter((dep) => !passed(dep));
  if (blocked.length) {
    results.push({ id, name, result: 'SKIP', ms: 0, note: `blocked by #${blocked.join(', #')}` });
    return;
  }
  current = { netMs: 0 };
  let result = 'PASS';
  let note = '';
  try {
    note = (await fn()) || '';
  } catch (error) {
    result = error instanceof Skip ? 'SKIP' : 'FAIL';
    note = error instanceof Error ? error.message : String(error);
  }
  results.push({ id, name, result, ms: current.netMs, note: scrub(note) });
  current = null;
}
const passed = (id) => results.find((r) => r.id === id)?.result === 'PASS';

// ---------- shared state ----------
const run = randomUUID().slice(0, 8);
const anon = new Actor('anon', '');
const customer = new Actor('customer', CUSTOMER_ORIGIN);
const admin = new Actor('admin', ADMIN_ORIGIN);
const state = { audit: [] };
const deliveryDate = (days) =>
  new Date(Date.now() + 5.5 * 3600000 + days * 86400000).toISOString().slice(0, 10);
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const quantityFor = (p, wanted) => {
  const step = p.quantityStep || 1;
  const q = Math.max(wanted, p.minQuantity || 1);
  return Math.ceil(q / step) * step;
};
let digits;
do digits = String(randomInt(10000, 100000));
while (`+9190000${digits}` === ADMIN_PHONE);
const customerPhone = `+9190000${digits}`;
const customerName = `Demo Test ${digits.slice(-4)}`;
const address = (pincode, extra = {}) => ({
  label: 'Site',
  name: customerName,
  phone: customerPhone,
  line1: `Plot ${digits.slice(-2)}, live test lane`,
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode,
  landmark: 'Near the water tank',
  ...extra,
});
async function signIn(actor, phone, code) {
  return actor.call('POST', '/auth/otp/verify', { body: { phone, code } });
}
async function reviewCart(addressId) {
  return customer.call('POST', '/checkout/review', {
    body: { addressId, deliveryDate: deliveryDate(2), paymentMethod: 'COD', notes: '' },
  });
}

// ---------- checks ----------
await check('1', 'health (live, ready, cold start)', async () => {
  const live = await anon.call('GET', '/health/live');
  const cold = live.ms;
  expectStatus(live, 200, 'live');
  const ready = await anon.call('GET', '/health/ready');
  expectStatus(ready, 200, 'ready');
  need(ready.json?.status === 'ready', `ready said ${ready.text.slice(0, 80)}`);
  const root = await anon.call('GET', '/health');
  expectStatus(root, 200, '/health');
  state.health = [live, ready, root];
  return `cold start ${cold} ms; ready ${ready.ms} ms`;
});

await check('2', 'customer OTP login + session', async () => {
  const sent = await customer.call('POST', '/auth/otp/request', { body: { phone: customerPhone } });
  expectStatus(sent, 201, 'otp/request');
  need(/^\d{6}$/.test(sent.json?.devCode || ''), 'no devCode for a customer (is DEMO_MODE on?)');
  const verified = await signIn(customer, customerPhone, sent.json.devCode);
  expectStatus(verified, 201, 'otp/verify');
  need(customer.jar.has('shiv_access'), 'no shiv_access cookie set');
  need(!verified.json?.accessToken, 'tokens returned in the body of a browser (Origin) sign-in');
  state.customerCookies = customer.setCookies;
  const session = await customer.call('GET', '/auth/session');
  expectStatus(session, 200, 'auth/session');
  need(session.json?.user?.phone === customerPhone, 'session is for a different user');
  need(session.json.user.role === 'CUSTOMER', `role ${session.json.user.role}`);
  const named = await customer.call('PATCH', '/me', {
    body: { name: customerName, language: 'en' },
  });
  expectStatus(named, 200, 'PATCH /me');
  const home = await customer.call('POST', '/me/addresses', { body: address('800001') });
  state.addressId = expectStatus(home, 201, 'add address').id;
  return `${customerName} (+91 90000 ${digits}), origin ${CUSTOMER_ORIGIN}`;
});

await check('3', 'catalog: seeded cement with prices', async () => {
  const r = await anon.call('GET', '/products?category=cement&limit=100');
  const items = expectStatus(r, 200, 'products').items || [];
  const found = [];
  for (const brand of ['UltraTech', 'ACC', 'Dalmia', 'Shree']) {
    const p = items.find((i) => i.brand?.toLowerCase() === brand.toLowerCase() && i.pricePaise > 0);
    need(p, `${brand} cement missing or unpriced`);
    found.push(`${brand} ${rupees(p.pricePaise)}`);
  }
  const usable = (p) => p.active && p.stock >= quantityFor(p, 2) * 3;
  state.orderProduct =
    items.find((p) => p.brand === 'UltraTech' && usable(p)) || items.find(usable);
  state.rateProduct =
    items.find((p) => p.brand === 'Shree' && p.id !== state.orderProduct?.id) ||
    items.find((p) => p.id !== state.orderProduct?.id);
  state.quoteProducts = items.filter(usable).slice(0, 2);
  need(state.orderProduct, 'no cement product with enough stock for a test order');
  return `${items.length} cement products; ${found.join(', ')}`;
});

await check(
  '4',
  'pincode delivery charge (800001, 800020; 110001 refused)',
  async () => {
    const zones = {};
    for (const pin of ['800001', '800020']) {
      const r = await anon.call('GET', `/delivery/${pin}`);
      expectStatus(r, 200, `delivery/${pin}`);
      need(r.json?.serviceable && r.json.zone, `${pin} not serviceable`);
      zones[pin] = r.json.zone;
      // The demo seed charges ₹500 in its Patna zone; EXPECTED_FEE_RUPEES overrides it.
      const expected = Number(process.env.EXPECTED_FEE_RUPEES || 500) * 100;
      need(
        r.json.zone.deliveryFeePaise === expected,
        `${pin} fee ${rupees(r.json.zone.deliveryFeePaise)}, expected ${rupees(expected)}`,
      );
    }
    const far = await anon.call('GET', '/delivery/110001');
    expectStatus(far, 200, 'delivery/110001');
    need(far.json?.serviceable === false, '110001 reported serviceable');
    const p = state.orderProduct;
    state.qty = quantityFor(p, 2);
    expectStatus(
      await customer.call('PUT', '/cart/items', { body: { productId: p.id, quantity: state.qty } }),
      200,
      'cart',
    );
    const review = await reviewCart(state.addressId);
    const snap = expectStatus(review, 201, 'checkout review 800001');
    const zone = zones['800001'];
    const fee =
      zone.freeDeliveryAbovePaise !== null && snap.subtotalPaise >= zone.freeDeliveryAbovePaise
        ? 0
        : zone.deliveryFeePaise;
    need(snap.deliveryFeePaise === fee, `fee ${snap.deliveryFeePaise} != zone fee ${fee}`);
    need(snap.totalPaise === snap.subtotalPaise + fee, 'total != subtotal + fee');
    state.review = { id: snap.id, at: Date.now() };
    const away = await customer.call('POST', '/me/addresses', {
      body: address('110001', { label: 'Delhi site', area: 'Connaught Place', city: 'Delhi' }),
    });
    const awayId = expectStatus(away, 201, 'add 110001 address').id;
    const refused = await reviewCart(awayId);
    need(
      refused.status === 409 && refused.json?.error?.code === 'NOT_SERVICEABLE',
      `110001 checkout not refused: ${why(refused)}`,
    );
    return `800001 fee ${rupees(zones['800001'].deliveryFeePaise)} (${zones['800001'].name}), 800020 fee ${rupees(zones['800020'].deliveryFeePaise)}; checkout fee ${rupees(snap.deliveryFeePaise)} on ${rupees(snap.subtotalPaise)}; 110001 → NOT_SERVICEABLE`;
  },
  { requires: ['2', '3'] },
);

await check(
  '5',
  'COD order placed by customer',
  async () => {
    const p = state.orderProduct;
    const before = await anon.call('GET', `/products/${encodeURIComponent(p.id)}`);
    state.stockBefore = expectStatus(before, 200, 'product').stock;
    let reviewId = state.review?.id;
    if (!reviewId || Date.now() - state.review.at > 240000) {
      expectStatus(
        await customer.call('PUT', '/cart/items', {
          body: { productId: p.id, quantity: state.qty },
        }),
        200,
        'cart',
      );
      reviewId = expectStatus(await reviewCart(state.addressId), 201, 'review').id;
    }
    state.reviewA = reviewId;
    const placed = await customer.call('POST', '/orders', {
      body: { reviewId, idempotencyKey: randomUUID() },
    });
    const order = expectStatus(placed, 201, 'place order');
    need(order.status === 'CONFIRMED', `status ${order.status}`);
    need(order.payment?.method === 'COD', `payment ${order.payment?.method}`);
    state.orderA = order;
    state.audit.push(['ORDER_CREATED', order.id]);
    return `${order.number}: ${state.qty} × ${p.name}, total ${rupees(order.totalPaise)}`;
  },
  { requires: ['4'] },
);

await check('6', 'admin login with staff code (no devCode)', async () => {
  const request = () => admin.call('POST', '/auth/otp/request', { body: { phone: ADMIN_PHONE } });
  let sent = await request();
  // A re-run within 30 s of the last code hits the resend wait: wait it out once.
  if (sent.status === 429 && sent.json?.error?.code === 'RATE_LIMITED') {
    await sleep(31000);
    sent = await request();
  }
  if (sent.status === 429)
    throw new Error(`${why(sent)} (the API allows 5 codes per phone per hour)`);
  expectStatus(sent, 201, 'admin otp/request');
  need(!/devCode/i.test(sent.text), 'admin otp/request exposed devCode');
  const verified = await signIn(admin, ADMIN_PHONE, STAFF_CODE);
  expectStatus(verified, 201, 'admin otp/verify');
  need(verified.json?.user?.role === 'ADMIN', `role ${verified.json?.user?.role}`);
  need(!verified.json?.accessToken, 'tokens returned in the body of a browser sign-in');
  state.adminCookies = admin.setCookies;
  const session = await admin.call('GET', '/auth/session');
  expectStatus(session, 200, 'admin session');
  state.adminId = session.json.user.id;
  return `signed in as ${session.json.user.name || 'staff'}; otp/request body has no devCode`;
});

await check(
  '7',
  'admin order lifecycle + cancel second order',
  async () => {
    const a = state.orderA;
    const listed = await admin.call('GET', `/admin/orders?q=${a.number}&limit=5`);
    need(
      expectStatus(listed, 200, 'admin orders').items?.some((o) => o.id === a.id),
      'order not visible to admin',
    );
    const move = async (status) => {
      const r = await admin.call('PATCH', `/admin/orders/${a.id}/status`, {
        body: { status, note: 'Live acceptance test' },
      });
      need(expectStatus(r, 200, status).status === status, `${status} not applied`);
      state.audit.push([`ORDER_${status}`, a.id]);
    };
    await move('PREPARING');
    await move('OUT_FOR_DELIVERY');
    const cod = await admin.call('POST', `/admin/orders/${a.id}/cod-received`, {
      body: { channel: 'CASH' },
    });
    expectStatus(cod, 201, 'cod-received');
    state.audit.push(['COD_RECEIVED', a.id]);
    await move('DELIVERED');
    // Second order, cancelled by the store.
    const p = state.orderProduct;
    expectStatus(
      await customer.call('PUT', '/cart/items', { body: { productId: p.id, quantity: state.qty } }),
      200,
      'cart (B)',
    );
    const review = expectStatus(await reviewCart(state.addressId), 201, 'review (B)');
    state.reviewB = review.id;
    const placed = await customer.call('POST', '/orders', {
      body: { reviewId: review.id, idempotencyKey: randomUUID() },
    });
    const b = expectStatus(placed, 201, 'place (B)');
    state.orderB = b;
    state.audit.push(['ORDER_CREATED', b.id]);
    const cancelled = await admin.call('PATCH', `/admin/orders/${b.id}/status`, {
      body: { status: 'CANCELLED', note: 'Live acceptance test cleanup' },
    });
    need(expectStatus(cancelled, 200, 'cancel B').status === 'CANCELLED', 'B not cancelled');
    state.audit.push(['ORDER_CANCELLED', b.id]);
    return `${a.number}: CONFIRMED→PREPARING→OUT_FOR_DELIVERY→COD received→DELIVERED; ${b.number} CANCELLED`;
  },
  { requires: ['5', '6'] },
);

await check(
  '8',
  'stock ledger: order decrements, cancel restores',
  async () => {
    const p = state.orderProduct;
    const q = state.qty;
    const r = await admin.call(
      'GET',
      `/admin/products/${encodeURIComponent(p.id)}/movements?limit=50`,
    );
    const rows = expectStatus(r, 200, 'movements').items || [];
    const find = (kind, ref, quantity) =>
      rows.find((m) => m.kind === kind && m.reference === ref && m.quantity === quantity);
    const placeA = find('ONLINE_ORDER', state.reviewA, -q);
    need(placeA, 'no ONLINE_ORDER movement for order A');
    need(find('ONLINE_ORDER', state.reviewB, -q), 'no ONLINE_ORDER movement for order B');
    const cancel = find('ORDER_CANCELLED', state.orderB?.id, q);
    need(cancel, 'no ORDER_CANCELLED movement restoring order B');
    const opening = placeA.balanceAfter - placeA.quantity;
    need(
      cancel.balanceAfter > rows.find((m) => m.reference === state.reviewB).balanceAfter,
      'cancellation did not raise the balance',
    );
    const now = expectStatus(
      await anon.call('GET', `/products/${encodeURIComponent(p.id)}`),
      200,
      'product',
    ).stock;
    // Other demo visitors may move stock at the same time: reconcile with every entry since ours.
    const since = rows.filter((m) => new Date(m.createdAt) >= new Date(placeA.createdAt));
    const net = since.reduce((sum, m) => sum + m.quantity, 0);
    need(
      now === opening + net,
      `stock ${now} != ${opening} + ledger ${net} (ledger and balance disagree)`,
    );
    const others = since.length - 3;
    return `${p.name}: ${opening} → ${placeA.balanceAfter} (A) → ${cancel.balanceAfter} after B cancel; now ${now}${opening !== state.stockBefore ? `; catalogue said ${state.stockBefore} before A` : ''}${others ? `; ${others} other movement(s) meanwhile` : ''}`;
  },
  { requires: ['7'] },
);

await check(
  '9',
  'bulk quote request visible to admin',
  async () => {
    const items = state.quoteProducts.map((p, i) => ({
      productId: p.id,
      quantity: quantityFor(p, i ? 50 : 100),
    }));
    need(items.length, 'no products to quote');
    const r = await customer.call('POST', '/quotes', {
      body: {
        idempotencyKey: randomUUID(),
        items,
        addressId: state.addressId,
        deliveryDate: deliveryDate(3),
        company: `${customerName} Builders`,
        gstin: '',
        notes: 'Live acceptance test request; no reply needed.',
      },
    });
    const quote = expectStatus(r, 201, 'quote request');
    need(quote.status === 'REQUESTED', `status ${quote.status}`);
    const listed = await admin.call('GET', '/admin/quotes?status=REQUESTED&limit=100');
    const seen = (expectStatus(listed, 200, 'admin quotes').items || []).find(
      (q) => q.id === quote.id,
    );
    need(seen, 'quote not in the admin REQUESTED list');
    need(seen.user?.phone === customerPhone, 'admin quote shows a different customer');
    // Acknowledge it so test quotes never fill the store's pending-quote limit.
    const ack = await admin.call('POST', `/admin/quotes/${quote.id}/acknowledge`);
    expectStatus(ack, 201, 'acknowledge quote');
    state.audit.push(['QUOTE_ACKNOWLEDGED', quote.id]);
    return `${quote.number}: ${items.map((i) => `${i.quantity} × ${i.productId}`).join(', ')}; seen and acknowledged by admin`;
  },
  { requires: ['2', '3', '6'] },
);

await check(
  '10',
  'Rate Studio manual batch: review → publish',
  async () => {
    const providers = await admin.call('GET', '/admin/rate-studio/providers');
    const ai = expectStatus(providers, 200, 'providers');
    const created = await admin.call('POST', '/admin/rate-studio/batches', {
      body: {
        title: `Live test ${run} (same price)`,
        sourceType: 'MANUAL',
        idempotencyKey: randomUUID(),
      },
    });
    let batch = expectStatus(created, 201, 'create batch');
    state.batchId = batch.id;
    state.audit.push(['RATE_BATCH_CREATED', batch.id]);
    const p = expectStatus(
      await anon.call('GET', `/products/${encodeURIComponent(state.rateProduct.id)}`),
      200,
      'rate product',
    );
    // The same price is published on purpose: the full review/publish path runs, but shared demo
    // prices and checkout price versions stay untouched for other visitors.
    const saved = await admin.call('PATCH', `/admin/rate-studio/batches/${batch.id}`, {
      body: {
        expectedVersion: batch.version,
        title: batch.title,
        items: [
          {
            productId: p.id,
            label: p.name,
            brand: p.brand,
            specification: [p.grade, p.type].filter(Boolean).join(' · '),
            unit: p.unit,
            weight: '',
            proposedPricePaise: p.pricePaise,
            included: true,
            reviewed: true,
            acknowledged: true,
            note: 'Live acceptance test: price unchanged',
            rememberAlias: false,
            refreshBaseline: false,
            expectedProductVersion: p.version,
          },
        ],
      },
    });
    batch = expectStatus(saved, 200, 'save batch');
    state.audit.push(['RATE_BATCH_REVIEWED', batch.id]);
    need(batch.status === 'READY', `batch ${batch.status}: ${JSON.stringify(batch.issues)}`);
    const row = batch.items?.[0];
    need(row?.oldPricePaise === p.pricePaise, 'review row lost the current price baseline');
    const published = await admin.call('POST', `/admin/rate-studio/batches/${batch.id}/publish`, {
      body: { expectedVersion: batch.version, confirmation: 'PUBLISH' },
    });
    batch = expectStatus(published, 201, 'publish');
    need(batch.status === 'PUBLISHED', `status ${batch.status}`);
    state.audit.push(['RATE_BATCH_PUBLISHED', batch.id]);
    const after = expectStatus(
      await anon.call('GET', `/products/${encodeURIComponent(p.id)}`),
      200,
      'product after publish',
    );
    need(
      after.pricePaise === p.pricePaise && after.priceVersion === p.priceVersion,
      'price changed by a same-price publish',
    );
    state.batchPublished = true;
    return `${p.name} ${rupees(p.pricePaise)} reviewed and published (issues: ${
      batch.issues?.map((i) => i.code).join(', ') || 'none'
    }); AI extraction ${ai.visionConfigured && ai.modelConfigured ? 'configured' : 'not configured (manual only)'}`;
  },
  { requires: ['3', '6'] },
);

await check(
  '10b',
  'Rate card PNG render',
  async () => {
    const r = await admin.call('POST', `/admin/rate-studio/batches/${state.batchId}/cards`, {
      body: {
        format: 'SQUARE',
        template: 'COUNTER',
        heading: "Today's cement rates",
        deliveryMessage: 'Delivery across Patna',
        contactLabel: 'Call or WhatsApp',
        promotionalCopy: '',
        confirmed: true,
      },
    });
    const card = expectStatus(r, 201, 'create card');
    state.audit.push(['RATE_CARD_CREATED', state.batchId]);
    const png = await admin.call('GET', `/admin/rate-studio/cards/${card.id}/pages/1/png`, {
      binary: true,
    });
    need(png.status === 200, `PNG ${why(png)}`);
    need(
      png.headers.get('content-type')?.startsWith('image/png') &&
        png.buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'response is not a PNG',
    );
    return `card ${card.id}: page 1 PNG ${Math.round(png.buf.length / 1024)} KB in ${png.ms} ms`;
  },
  { requires: ['10'] },
);

await check(
  '11',
  'audit log shows the actions',
  async () => {
    need(state.audit.length, 'nothing to look for');
    const wanted = new Set(state.audit.map(([e, id]) => `${e}:${id}`));
    let cursor = '';
    let rows = [];
    for (let page = 0; page < 3 && wanted.size; page++) {
      const r = await admin.call(
        'GET',
        `/admin/audit?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
      );
      const body = expectStatus(r, 200, 'audit');
      rows = rows.concat(body.items || []);
      for (const row of body.items || []) wanted.delete(`${row.event}:${row.entityId}`);
      if (!body.nextCursor) break;
      cursor = encodeURIComponent(body.nextCursor);
    }
    need(
      !wanted.size,
      `missing audit events: ${[...wanted].map((w) => w.split(':')[0]).join(', ')}`,
    );
    const named = rows.find((row) => row.actorId === state.adminId)?.actorName;
    return `${state.audit.length} expected events found${named ? `; staff shown as "${named}"` : ''}`;
  },
  { requires: ['6'] },
);

await check('12', 'CORS + cookie attributes', async () => {
  const notes = [];
  if (VIA_FRONTEND) {
    // Browsers call their own origin, so no preflight happens; record what the gateway does.
    const pre = await anon.call('OPTIONS', '/orders', {
      origin: ADMIN_ORIGIN,
      headers: { 'Access-Control-Request-Method': 'PATCH' },
    });
    notes.push(
      `same-origin via frontends (direct API preflight: ${pre.status}, allow-origin ${pre.headers.get('access-control-allow-origin') || 'none'})`,
    );
  } else {
    const pre = await anon.call('OPTIONS', '/orders', {
      origin: ADMIN_ORIGIN,
      headers: {
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    need([200, 204].includes(pre.status), `preflight ${why(pre)}`);
    need(
      pre.headers.get('access-control-allow-origin') === ADMIN_ORIGIN,
      `preflight allow-origin "${pre.headers.get('access-control-allow-origin')}"`,
    );
    need(pre.headers.get('access-control-allow-credentials') === 'true', 'no allow-credentials');
    notes.push(`preflight ${pre.status} allows ${ADMIN_ORIGIN} with credentials`);
    const evilPre = await anon.call('OPTIONS', '/orders', {
      origin: 'https://evil.example',
      headers: { 'Access-Control-Request-Method': 'POST' },
    });
    need(
      !evilPre.headers.get('access-control-allow-origin'),
      'evil.example preflight received an allow-origin header',
    );
  }
  // A cookie-carrying write from a foreign origin must be refused before it does anything.
  const actor = customer.jar.size ? customer : anon;
  const evil = await actor.call('PUT', '/cart/items', {
    origin: 'https://evil.example',
    body: { productId: state.orderProduct?.id || 'x', quantity: 0 },
  });
  need(evil.status === 403, `evil-origin write: ${why(evil)}`);
  if (customer.jar.size) {
    // A signed-in customer must be refused on staff endpoints.
    const staffOnly = await customer.call('GET', '/admin/orders?limit=1');
    need(
      [401, 403].includes(staffOnly.status),
      `customer reached /admin/orders: ${why(staffOnly)}`,
    );
    notes.push(`customer refused on /admin/orders (${staffOnly.status})`);
  }
  notes.push(`evil write 403${actor === customer ? ' (with session cookie)' : ''}`);
  const cookies = [...(state.customerCookies || []), ...(state.adminCookies || [])].filter((c) =>
    /^shiv_(access|refresh)=/.test(c),
  );
  need(cookies.length >= 2, 'no session cookies were captured');
  for (const c of cookies) {
    const name = c.split('=')[0];
    need(/;\s*HttpOnly/i.test(c), `${name} missing HttpOnly`);
    need(/;\s*SameSite=Lax/i.test(c), `${name} missing SameSite=Lax`);
    need(/;\s*Path=\/api\/v1/i.test(c), `${name} path is not /api/v1`);
    if (HTTPS) need(/;\s*Secure/i.test(c), `${name} missing Secure`);
  }
  notes.push(
    `${cookies.length} cookies HttpOnly, SameSite=Lax, Path=/api/v1${HTTPS ? ', Secure' : '; Secure not required over http'}`,
  );
  return notes.join('; ');
});

const productNames = () => [
  ...new Set(
    [state.orderProduct, state.rateProduct, ...(state.quoteProducts || [])]
      .filter(Boolean)
      .map((p) => p.name),
  ),
];
async function frontend(origin, label, { productRequired = false } = {}) {
  // The shop home is a rate board; product names are server-rendered on the material page.
  const path = productRequired && state.orderProduct ? `/products/${state.orderProduct.id}` : '/';
  if (!origin) throw new Skip(`${label} origin not set`);
  const started = performance.now();
  let res;
  try {
    res = await fetch(origin + path, {
      headers: { Accept: 'text/html', 'User-Agent': 'shiv-live-test/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const host = new URL(origin).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(host))
      throw new Skip(`${origin} unreachable locally (${error.cause?.code || error.name})`);
    throw new Error(`${origin} unreachable: ${error.cause?.code || error.message}`);
  }
  const html = await res.text();
  current.netMs += Math.round(performance.now() - started);
  scan(`GET ${label}`, html);
  need(res.status === 200, `${label} HTTP ${res.status}`);
  need(/text\/html/i.test(res.headers.get('content-type') || ''), `${label} is not HTML`);
  need(/<html/i.test(html), `${label} body is not an HTML page`);
  const notes = [`200 HTML ${Math.round(html.length / 1024)} KB`];
  if (productRequired) {
    const names = productNames();
    need(names.length, 'no catalogue names known (check 3 failed)');
    const hit = names.find((n) => html.includes(n));
    need(hit, `none of ${names.join(', ')} rendered server-side`);
    notes.push(`server-rendered "${hit}"`);
  }
  return notes.join('; ');
}
await check('13a', 'frontend: admin', () => frontend(ADMIN_ORIGIN, 'admin'));
await check('13b', 'frontend: shop (SSR product)', () =>
  frontend(SHOP_ORIGIN, 'shop', { productRequired: true }),
);
await check('13c', 'frontend: customer app', () => frontend(APP_ORIGIN, 'app'));

await check('14', 'no secrets leak', async () => {
  need(!stats.leaks.length, `staff code appeared in: ${[...new Set(stats.leaks)].join(', ')}`);
  for (const r of state.health || []) {
    const keys = Object.keys(r.json || {});
    need(
      keys.every((k) => k === 'status'),
      `health exposes keys: ${keys.join(', ')}`,
    );
    need(
      !/DATABASE_URL|postgres(ql)?:\/\/|SECRET|NODE_ENV|password|TOKEN/i.test(r.text),
      'health body mentions configuration',
    );
    need(!r.headers.get('x-powered-by'), 'health sends X-Powered-By');
  }
  need(state.health?.length, 'health responses unavailable (check 1 failed)');
  return `${stats.requests} API responses scanned for the staff code; health bodies are {status} only`;
});

// ---------- cleanup: never leave a pending COD order behind (it counts against store limits) ----
const cleanup = [];
for (const order of [state.orderA, state.orderB].filter(Boolean)) {
  if (passed('7') || !customer.jar.size) continue;
  const r = await customer.call('POST', `/orders/${order.id}/cancel`).catch((e) => ({
    status: 0,
    json: { error: { message: e.message } },
  }));
  cleanup.push(`${order.number}: ${r.status === 201 ? 'cancelled by customer' : why(r)}`);
}

// ---------- report ----------
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [
  `Live test ${run} against ${API} (${stats.requests} API requests, cold start ${stats.firstMs ?? '?'} ms)`,
  '',
  '| # | check | result | ms | note |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${cell(r.name)} | ${r.result} | ${r.ms} | ${cell(r.note)} |`),
];
if (cleanup.length) lines.push('', `Cleanup: ${cell(cleanup.join('; '))}`);
console.log(lines.join('\n'));
const failed = results.filter((r) => r.result === 'FAIL').length;
const report = {
  run,
  apiOrigin: API,
  adminOrigin: ADMIN_ORIGIN,
  shopOrigin: SHOP_ORIGIN,
  appOrigin: APP_ORIGIN,
  startedAt: stats.startedAt,
  finishedAt: new Date().toISOString(),
  coldStartMs: stats.firstMs,
  apiRequests: stats.requests,
  customer: customerName,
  cleanup,
  summary: {
    pass: results.filter((r) => r.result === 'PASS').length,
    fail: failed,
    skip: results.filter((r) => r.result === 'SKIP').length,
  },
  results,
};
if (env('REPORT_PATH')) {
  mkdirSync(dirname(env('REPORT_PATH')), { recursive: true });
  writeFileSync(env('REPORT_PATH'), scrub(JSON.stringify(report, null, 2)) + '\n');
}
process.exitCode = failed ? 1 : 0;

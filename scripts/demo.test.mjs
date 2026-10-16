/* global Headers, Response */
import assert from 'node:assert/strict';
import test from 'node:test';
import { quantityProblem, totals } from '@shiv/shared';
import {
  DEMO_NOTE,
  DEMO_PHONE_PREFIX,
  DEMO_PREFIX,
  PRACTICE_PINCODE,
  demoPhones,
  demoTarget,
  sampleData,
} from './demo-lib.mjs';
import { restore } from './demo.mjs';
import { preflight, preflightArgs, table } from './demo-preflight.mjs';

const url = (db, host = '127.0.0.1') => `postgresql://owner:s3cret-pw@${host}:5432/${db}`;

test('demo guard accepts only *_test databases, or staging with DEMO_TARGET=staging', () => {
  assert.equal(demoTarget({ DATABASE_URL: url('shiv_demo_test') }).database, 'shiv_demo_test');
  const staging = demoTarget({
    DATABASE_URL: `${url('shiv_staging', 'db.staging.example.in')}?sslmode=require`,
    DEMO_TARGET: 'staging',
    NODE_ENV: 'production',
  });
  assert.equal(staging.label, 'database "shiv_staging" on db.staging.example.in');
  assert.equal(staging.pgEnv.PGSSLMODE, 'require');
  assert.equal(staging.pgEnv.PGPASSWORD, 's3cret-pw');

  for (const [env, reason] of [
    [{}, /Set DATABASE_URL/],
    [{ DATABASE_URL: 'not a url' }, /Set DATABASE_URL/],
    [{ DATABASE_URL: 'mysql://u:p@h/x_test' }, /postgresql/],
    [{ DATABASE_URL: url('shiv') }, /ending in _test/],
    [{ DATABASE_URL: url('shiv_test_copy') }, /ending in _test/],
    [{ DATABASE_URL: url('shiv_staging') }, /ending in _test/],
    [{ DATABASE_URL: url('shiv_staging'), DEMO_TARGET: 'production' }, /only be "staging"/],
    [{ DATABASE_URL: url('shiv'), DEMO_TARGET: 'staging' }, /ending in _test/],
    [{ DATABASE_URL: url('shiv_demo_test'), NODE_ENV: 'production' }, /DEMO_TARGET=staging/],
    [{ DATABASE_URL: url('shiv_prod_staging'), DEMO_TARGET: 'staging' }, /production database/],
    [{ DATABASE_URL: url('shiv_production_test') }, /production database/],
    [{ DATABASE_URL: url('') }, /unexpected database name/],
    [{ DATABASE_URL: url('a%2Fb_test') }, /unexpected database name/],
  ]) {
    assert.throws(
      () => demoTarget(env),
      (error) => {
        assert.match(error.message, reason);
        // Refusals name the database and host only, never the credentials.
        assert.doesNotMatch(error.message, /s3cret|owner:/);
        return true;
      },
      JSON.stringify(env),
    );
  }
});

test('staging demo customers use family-approved numbers and restore reapplies grants', () => {
  assert.throws(() => demoPhones({}, true), /DEMO_PHONES/);
  assert.throws(() => demoPhones({ DEMO_PHONES: '+919876543210' }, true), /exactly three/);
  const approved = '+919876543210, +919876543211,+919876543212';
  const phones = demoPhones({ DEMO_PHONES: approved }, true);
  assert.deepEqual(phones, ['+919876543210', '+919876543211', '+919876543212']);
  const data = sampleData(phones);
  assert.deepEqual(
    data.customers.map((c) => [c.phone, c.address.phone]),
    phones.map((p) => [p, p]),
  );
  // Local _test databases keep the sample block without any setting.
  assert(demoPhones({}, false).every((p) => p.startsWith(DEMO_PHONE_PREFIX)));
  const staging = demoTarget({
    DATABASE_URL: url('shiv_staging', 'db.example'),
    DEMO_TARGET: 'staging',
  });
  assert.throws(() => restore(staging, import.meta.filename, true), /--runtime-role/);
  assert.throws(
    () => restore(staging, import.meta.filename, true, 'x; DROP ROLE y'),
    /plain role name/,
  );
});

test('sample catalogue is clearly labelled, bilingual and sellable', () => {
  const { categories, products, zone, customers, orders, quote } = sampleData();
  assert.deepEqual(categories.map((c) => c.slug).sort(), [
    'aggregates',
    'bricks',
    'cement',
    'sand',
    'steel',
  ]);
  assert.deepEqual(
    new Set(products.map((p) => p.unit)),
    new Set(['bag', 'kg', 'tonne', 'cft', 'piece']),
  );
  for (const category of categories)
    assert(
      products.some((p) => p.category === category.slug),
      `${category.slug} has no product`,
    );
  assert.equal(new Set(products.map((p) => p.id)).size, products.length);
  for (const p of products) {
    assert(p.id.startsWith(DEMO_PREFIX), p.id);
    assert.match(p.name, /^Sample /, p.id);
    assert.match(p.nameHi, /[ऀ-ॿ]/, `${p.id} Hindi name`);
    assert.match(p.descriptionHi, /[ऀ-ॿ]/, `${p.id} Hindi description`);
    assert(p.description.startsWith(DEMO_NOTE), `${p.id} not labelled as sample`);
    assert(p.unit && p.packSize && p.type && p.grade && p.recommendedUse, p.id);
    assert(Number.isSafeInteger(p.pricePaise) && p.pricePaise > 0, `${p.id} price`);
    assert(Number.isInteger(p.quantityStep) && p.quantityStep >= 1, `${p.id} step`);
    assert(Number.isInteger(p.minQuantity) && p.minQuantity >= 1, `${p.id} minimum`);
    assert(p.minQuantity <= p.stock && p.stock <= 1_000_000, `${p.id} stock`);
    assert(p.description.length <= 1500 && p.name.length <= 120, `${p.id} length`);
  }
  assert.equal(zone.pincode, PRACTICE_PINCODE);
  assert(zone.id.startsWith(DEMO_PREFIX) && zone.deliveryFeePaise > 0);
  for (const c of customers) {
    assert(c.id.startsWith(DEMO_PREFIX));
    assert(c.phone.startsWith(DEMO_PHONE_PREFIX) && /^\+91[6-9]\d{9}$/.test(c.phone), c.phone);
    assert.equal(c.address.pincode, PRACTICE_PINCODE);
  }
  // Orders and the quote obey each product's selling rules, stock and the zone's minimum.
  const byId = new Map(products.map((p) => [p.id, p]));
  const left = new Map(products.map((p) => [p.id, p.stock]));
  assert.deepEqual(
    orders.map((o) => o.status),
    ['CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  );
  for (const spec of [...orders, quote]) {
    assert(spec.id.startsWith(DEMO_PREFIX) && customers.some((c) => c.id === spec.customer));
    for (const line of spec.lines) {
      assert.equal(quantityProblem(byId.get(line.productId), line.quantity), null, spec.id);
      if (spec !== quote) left.set(line.productId, left.get(line.productId) - line.quantity);
    }
  }
  for (const [id, stock] of left) assert(stock >= byId.get(id).minQuantity, `${id} sold out`);
  for (const spec of orders) {
    const lines = spec.lines.map((l) => ({ ...l, pricePaise: byId.get(l.productId).pricePaise }));
    const amounts = totals(lines, zone.deliveryFeePaise, zone.freeDeliveryAbovePaise);
    assert(amounts.subtotalPaise >= zone.minimumOrderPaise, spec.id);
  }
});

function api(change = () => {}) {
  const requests = [];
  const request = async (target, options) => {
    requests.push({ target, options });
    const headers = new Headers({ 'x-content-type-options': 'nosniff' });
    const path = new URL(target).pathname;
    let body;
    if (path.endsWith('/health/live')) body = { status: 'ok' };
    else if (path.endsWith('/health/ready')) body = { status: 'ready' };
    else if (path.endsWith('/products'))
      body = {
        items: [{ name: 'Sample PPC Cement', unit: 'bag', pricePaise: 39500 }],
        nextCursor: null,
      };
    else if (path.endsWith(`/delivery/${PRACTICE_PINCODE}`))
      body = { serviceable: true, zone: { name: 'SAMPLE', deliveryFeePaise: 50000 } };
    else if (path.endsWith('/store')) {
      body = { onlinePaymentsAvailable: false };
      if (options.headers.Origin) {
        headers.set('access-control-allow-origin', options.headers.Origin);
        headers.set('access-control-allow-credentials', 'true');
      }
    } else if (path.endsWith('/client-config'))
      body = {
        android: {
          minimumVersion: '1.0.0',
          latestVersion: '1.2.0',
          storeUrl: 'https://play.google.com/store/apps/details?id=x',
        },
      };
    else {
      body = '<title>Shiv Cement Store</title>Store desk';
      headers.set('content-type', 'text/html');
      headers.set(
        'content-security-policy',
        "script-src 'nonce-x' 'strict-dynamic'; frame-ancestors 'none'",
      );
    }
    const result = { status: 200, headers, body };
    change(result, path);
    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      result,
    );
  };
  return { request, requests };
}

test('demo preflight passes a ready API with GET requests only and fails clearly otherwise', async () => {
  const options = preflightArgs([
    'http://127.0.0.1:4000/api/v1/',
    '--site',
    'http://localhost:3003',
    '--desk=http://localhost:3000',
  ]);
  assert.equal(options.api, 'http://127.0.0.1:4000/api/v1');
  assert.throws(() => preflightArgs(['https://user:pw@api.example.in']), /without credentials/);
  assert.throws(() => preflightArgs(['--write']), /Unknown option/);

  const ok = api();
  const rows = await preflight(options, ok.request);
  assert.deepEqual(
    rows.filter((r) => !['PASS', 'WARN'].includes(r.status)),
    [],
    table(rows),
  );
  assert.equal(rows.find((r) => r.check === 'OTP mode').status, 'WARN');
  for (const { options: sent } of ok.requests) {
    assert.equal(sent.method, 'GET');
    assert.equal(sent.body, undefined);
    assert.equal(sent.headers.Authorization, undefined);
  }

  const broken = api((result, path) => {
    if (path.endsWith('/products'))
      result.body = { items: [{ name: 'X', unit: '', pricePaise: 0 }] };
    if (path.endsWith('/store')) result.body = { onlinePaymentsAvailable: true };
    if (path.endsWith('/delivery/800099')) result.body = { serviceable: false, zone: null };
    if (path.endsWith('/client-config'))
      result.body = { android: { minimumVersion: '2.0.0', latestVersion: '1.0.0', storeUrl: '' } };
  });
  const failed = (await preflight({ api: options.api }, broken.request))
    .filter((r) => r.status === 'FAIL')
    .map((r) => r.check);
  assert.deepEqual(failed, [
    'Catalogue: products with unit and price',
    `Delivery to ${PRACTICE_PINCODE}`,
    'Online payments off',
    'Android versions',
  ]);
  const down = await preflight({ api: options.api }, async () => {
    throw new Error('connect ECONNREFUSED');
  });
  assert(down.filter((r) => r.status === 'FAIL').length >= 5);
});

// Writes to a real database: only the caller's own *_test database, and only when asked for.
test(
  'prepare is idempotent and reset removes only demo rows',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL is not set' },
  async () => {
    const target = demoTarget({ DATABASE_URL: process.env.TEST_DATABASE_URL });
    const { PrismaClient, Prisma } = await import('@prisma/client');
    const { prepare, reset } = await import('./demo.mjs');
    const db = new PrismaClient({ datasourceUrl: target.url });
    const quiet = { Prisma, log: () => {} };
    const keep = { user: 'w2-keep-user', category: 'w2-keep-category', product: 'w2-keep-product' };
    const cleanup = async () => {
      await db.cartItem.deleteMany({ where: { userId: keep.user } });
      await db.user.deleteMany({ where: { id: keep.user } });
      await db.product.deleteMany({ where: { id: keep.product } });
      await db.category.deleteMany({ where: { id: keep.category } });
    };
    try {
      await reset(db, quiet);
      await cleanup();
      // Someone else's records, which reset must not touch.
      await db.user.create({ data: { id: keep.user, phone: '+919811100001', name: 'Keep' } });
      await db.category.create({ data: { id: keep.category, name: 'Keep', slug: 'w2-keep' } });
      await db.product.create({
        data: {
          id: keep.product,
          name: 'Keep',
          brand: 'Keep',
          categoryId: keep.category,
          type: 'x',
          grade: 'x',
          unit: 'bag',
          pricePaise: 100,
          description: 'x',
          recommendedUse: 'x',
        },
      });

      const first = await prepare(db, quiet);
      assert.deepEqual(
        { ...first, categories: undefined, zone: undefined },
        { products: 8, customers: 3, orders: 3, quotes: 1, categories: undefined, zone: undefined },
      );
      assert.deepEqual(await prepare(db, quiet), {
        categories: 0,
        products: 0,
        zone: 0,
        customers: 0,
        orders: 0,
        quotes: 0,
      });
      const orders = await db.order.findMany({
        where: { id: { startsWith: DEMO_PREFIX } },
        include: { payment: true, items: true, history: true, work: true },
        orderBy: { id: 'asc' },
      });
      assert.deepEqual(
        orders.map((o) => [o.status, o.payment.status, o.history.length]),
        [
          ['CONFIRMED', 'PENDING', 1],
          ['OUT_FOR_DELIVERY', 'PENDING', 3],
          ['DELIVERED', 'CAPTURED', 4],
        ],
      );
      for (const order of orders)
        assert.equal(
          order.totalPaise,
          order.items.reduce((sum, i) => sum + i.lineTotalPaise, 0) + order.deliveryFeePaise,
        );
      assert.equal(orders[0].work.acknowledgedAt, null);
      const quote = await db.quote.findUniqueOrThrow({
        where: { id: `${DEMO_PREFIX}quote-1` },
        include: { items: true },
      });
      assert.equal(quote.status, 'REQUESTED');
      assert(quote.items.every((i) => i.unitPricePaise === null));
      // Sample orders hold their stock, but nothing goes into the permanent ledgers or audit log.
      const cement = await db.product.findUniqueOrThrow({
        where: { id: `${DEMO_PREFIX}ppc-cement` },
      });
      assert.equal(cement.stock, 800 - 50 - 20);
      assert.equal(
        await db.inventoryMovement.count({ where: { productId: { startsWith: DEMO_PREFIX } } }),
        0,
      );
      assert.equal(
        await db.financialMovement.count({
          where: { paymentId: { in: orders.map((o) => o.payment.id) } },
        }),
        0,
      );
      assert.equal(
        await db.auditLog.count({ where: { entityId: { startsWith: DEMO_PREFIX } } }),
        0,
      );
      assert(
        (await db.deliveryPincode.findUnique({ where: { pincode: PRACTICE_PINCODE } })) !== null,
      );

      // A sample product in someone else's cart is hidden, not deleted, along with its category.
      await db.cartItem.create({
        data: {
          userId: keep.user,
          productId: cement.id,
          quantity: 1,
          seenPricePaise: cement.pricePaise,
          seenPriceVersion: 1,
        },
      });
      const removed = await reset(db, quiet);
      assert.equal(removed.orders, 3);
      assert.equal(removed.quotes, 1);
      assert.equal(removed.customers, 3);
      assert.equal(removed.products, 7);
      assert.deepEqual(removed.kept, { orders: 0, products: 1, customers: 0 });
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: cement.id } })).active,
        false,
      );
      await db.cartItem.deleteMany({ where: { userId: keep.user } });
      assert.equal((await reset(db, quiet)).products, 1);

      for (const model of [
        'order',
        'quote',
        'product',
        'checkoutReview',
        'ownerWork',
        'notification',
      ])
        assert.equal(
          await db[model].count({ where: { id: { startsWith: DEMO_PREFIX } } }),
          0,
          model,
        );
      assert.equal(await db.user.count({ where: { phone: { startsWith: DEMO_PHONE_PREFIX } } }), 0);
      assert.equal(await db.deliveryZone.count({ where: { id: { startsWith: DEMO_PREFIX } } }), 0);
      assert.equal(await db.category.count({ where: { id: { startsWith: 'demo-cat-' } } }), 0);
      assert.equal(await db.user.count({ where: { id: keep.user } }), 1);
      assert.equal(await db.product.count({ where: { id: keep.product } }), 1);
      assert.equal(await db.category.count({ where: { id: keep.category } }), 1);
    } finally {
      await reset(db, quiet).catch(() => {});
      await cleanup();
      await db.$disconnect();
    }
  },
);

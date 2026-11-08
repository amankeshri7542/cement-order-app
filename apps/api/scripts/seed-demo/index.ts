/**
 * The demo seed: a realistic, made-up business for demos, tests and speed checks.
 *
 *   npm run seed:demo -w @shiv/api -- --size small|medium|large --seed 42 [--today 2026-11-08] [--fresh]
 *
 * It refuses any database whose name does not end in _dev, _demo or _test, refuses NODE_ENV=production,
 * and refuses a database holding orders it did not make. While its DemoBatch row exists the API sends
 * no SMS, WhatsApp or push (the sink lock in src/demo-lock.ts). Rows in append-only tables cannot be
 * deleted, so reseeding means --fresh: drop and recreate the database.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Bulk } from './bulk';
import { istInstant, istToday } from './calendar';
import { makeContext } from './context';
import { recreateDatabase } from './fresh';
import { existingDataRefusal, parseSeedArgs, seedTarget } from './guard';
import { checkInvariants } from './invariants';
import { buildManifest } from './manifest';
import { PhoneBook } from './names';
import { Rng } from './rng';
import { registerTables } from './tables';
import { seedAttendance } from './modules/attendance';
import { seedBusiness } from './modules/business';
import { seedCatalogue } from './modules/catalogue';
import {
  planCustomers,
  planStaff,
  updateCustomerTotals,
  writeCustomers,
  writeStaff,
} from './modules/people';
import { seedPlaces } from './modules/places';
import { seedSalary } from './modules/salary';
import { seedWhatsApp } from './modules/whatsapp';

export async function runSeed(argv: readonly string[], env: Record<string, string | undefined>) {
  const options = parseSeedArgs(argv, istToday());
  const target = seedTarget(env);
  const started = Date.now();
  const lap = (label: string) =>
    console.log(`  ${label} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(
    `Demo seed: ${options.size}, seed ${options.seed}, up to ${options.today}, into ${target.label}`,
  );
  if (options.fresh) {
    await recreateDatabase(env);
    lap('database dropped, recreated and migrated');
  }
  const db = new PrismaClient({ datasources: { db: { url: target.url.toString() } } });
  try {
    const [foreign] = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "Order" WHERE id NOT LIKE 'demo-%'`,
    );
    const refusal = existingDataRefusal({
      foreignOrders: Number(foreign?.n ?? 0),
      batches: await db.demoBatch.count(),
      label: target.label,
    });
    if (refusal) throw new Error(refusal);

    const ctx = makeContext({
      size: options.size,
      seed: options.seed,
      today: options.today,
      existingCategories: new Set(
        (await db.category.findMany({ select: { slug: true } })).map((c) => c.slug),
      ),
    });
    // First, before any data: from here on the API refuses to send anything.
    await db.demoBatch.create({
      data: { id: ctx.batchId, size: ctx.size, seed: ctx.seed, today: ctx.today, manifest: {} },
    });
    const root = new Rng(options.seed);
    const phones = new PhoneBook(root.fork('phones'));
    phones.reserve((await db.user.findMany({ select: { phone: true } })).map((u) => u.phone));
    const now = istInstant(ctx.today, 16, 30);

    await seedPlaces(db, ctx);
    const bulk = new Bulk(db);
    registerTables(bulk);
    const products = await seedCatalogue(ctx, bulk, root.fork('catalogue'));
    const staff = planStaff(ctx, root.fork('staff'), phones);
    const customers = planCustomers(ctx, root.fork('customers'), phones);
    await writeStaff(ctx, bulk, staff);
    await writeCustomers(ctx, bulk, customers);
    lap(`${products.length} products, ${customers.length} customers, ${staff.length} staff`);
    const facts = await seedAttendance(ctx, bulk, root.fork('attendance'), staff, now);
    const payouts = await seedSalary(ctx, bulk, root.fork('salary'), staff, facts, now);
    lap('attendance and salary');
    const business = await seedBusiness(ctx, bulk, root.fork('business'), {
      products,
      customers,
      staff,
      payouts,
      now,
    });
    lap(`${business.orders} orders with stock, khata and galla`);
    await seedWhatsApp(ctx, bulk, root.fork('whatsapp'), {
      orders: business.waOrders,
      products,
      customers,
      now,
    });
    // Inserting a product fires the stock bridge, which gives it an empty main-shop row. The real
    // levels replace those rows.
    await bulk.flush();
    await db.$executeRawUnsafe(`DELETE FROM "StockLevel" WHERE "productId" LIKE 'demo-%'`);
    const low = new Map(products.map((p) => [p.id, p.lowStockAt]));
    const counted = new Map(products.map((p) => [p.id, p.counted]));
    for (const [k, quantity] of business.levels) {
      const [productId, locationId] = k.split('|') as [string, string];
      await bulk.add('StockLevel', {
        productId,
        locationId,
        quantity,
        lowStockAt: locationId.includes('godown')
          ? (low.get(productId) ?? 0) * 3
          : (low.get(productId) ?? 0),
        isOn: counted.get(productId) ? true : quantity > 0,
        countedAt: null,
        updatedAt: now,
      });
    }
    await bulk.flush();
    lap('rows written');

    // Product.stock is the total over every location. The bridge trigger stays out of the way.
    await db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('shiv.stock_direct', 'on', true)`),
      db.$executeRawUnsafe(
        `UPDATE "Product" p SET stock = s.q FROM (SELECT "productId", sum(quantity)::int AS q FROM "StockLevel" GROUP BY 1) s
          WHERE p.id = s."productId" AND p.id LIKE 'demo-%'`,
      ),
    ]);
    await updateCustomerTotals(db, business.totals);
    lap('totals set');

    const checks = await checkInvariants(db);
    if (checks.failures.length)
      throw new Error(`The seed broke its own rules:\n  ${checks.failures.join('\n  ')}`);
    lap(
      `invariants hold (${checks.gallaDays} galla days, ${checks.chains.attendance} hazri events, ${checks.chains.pay} pay entries)`,
    );

    const manifest = await buildManifest(db, {
      size: ctx.size,
      seed: ctx.seed,
      today: ctx.today,
      batchId: ctx.batchId,
    });
    await db.demoBatch.update({
      where: { id: ctx.batchId },
      data: { manifest: JSON.parse(JSON.stringify(manifest)) as object },
    });
    const path = resolve(
      options.manifestPath ?? `${__dirname}/../../../../.local/seed-manifest.json`,
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    lap(`manifest written to ${path}`);
    console.log(
      'Done. The API will refuse to send SMS, WhatsApp or push while this demo data exists; restart it if it is running.',
    );
    return { manifest, written: Object.fromEntries(bulk.written) };
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module)
  runSeed(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

// Demo data for the family review on staging (or a local *_test database).
//
//   node scripts/demo.mjs prepare            add the sample catalogue, customers, orders and quote
//   node scripts/demo.mjs reset              remove exactly what prepare added (and demo-customer activity)
//   node scripts/demo.mjs snapshot <file>    pg_dump the target database to <file>
//   node scripts/demo.mjs restore <file> --yes   replace the target database with <file>
//
// DATABASE_URL names the target and must pass demoTarget() (scripts/demo-lib.mjs): a database
// ending in _test, or DEMO_TARGET=staging with "staging" in the database name. Use the migration
// role: the API's runtime role is not allowed to delete orders, payments or audit rows. Staff
// accounts are never created here (bootstrap does that). PG_BIN points at PostgreSQL 16 tools.
// Take a snapshot before prepare: reset leaves whatever the permanent stock and money ledgers
// still point at (see reset below), and restoring the snapshot is the complete rollback.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { orderStatusText, totals } from '@shiv/shared';
import {
  DEMO_ACTOR,
  DEMO_PHONE_PREFIX,
  PRACTICE_PINCODE,
  demoTarget,
  istDate,
  sampleData,
} from './demo-lib.mjs';

const transaction = { maxWait: 10000, timeout: 120000 };
const hours = (n) => new Date(Date.now() - n * 3600000);
// The steps an order passes through on the desk, in order, for each sample status.
const statusPath = {
  CONFIRMED: ['CONFIRMED'],
  OUT_FOR_DELIVERY: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'],
  DELIVERED: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
};

/** Whether the generated client knows Product.nameHi/descriptionHi (added by another change). */
export function supportsHindi(Prisma) {
  const fields = Prisma?.ProductScalarFieldEnum || {};
  return 'nameHi' in fields && 'descriptionHi' in fields;
}

// Sample rows never touch the permanent records: the stock and money ledgers are immutable and
// audit evidence is kept, so reset can take every sample row out again. As a result sample
// products have no opening stock entry and the delivered sample order has no cash-collection row
// (it is missing from the cash report). What the family records during the demo is real ledger data.
async function takeStock(tx, productId, quantity) {
  const changed = await tx.product.updateMany({
    where: { id: productId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  if (!changed.count) throw new Error(`Not enough sample stock for ${productId}.`);
}

export async function prepare(db, { Prisma, log = console.log } = {}) {
  const data = sampleData();
  const hindi = supportsHindi(Prisma);
  if (!hindi)
    log(
      'Warning: this Prisma client has no Product.nameHi/descriptionHi yet; Hindi names were skipped.',
    );
  const made = { categories: 0, products: 0, zone: 0, customers: 0, orders: 0, quotes: 0 };
  await db.$transaction(async (tx) => {
    // Store settings are only created when missing; existing values stay as the owners set them.
    await tx.storeSettings.upsert({
      where: { id: 'store' },
      update: {},
      create: { id: 'store', onlinePaymentsEnabled: false },
    });
    const settings = await tx.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });

    const categoryIds = {};
    for (const category of data.categories) {
      const existing = await tx.category.findUnique({ where: { slug: category.slug } });
      categoryIds[category.slug] =
        existing?.id ||
        (await tx.category.create({ data: { id: `demo-cat-${category.slug}`, ...category } })).id;
      if (!existing) made.categories++;
    }

    for (const { category, nameHi, descriptionHi, ...product } of data.products) {
      // An existing sample product is left alone (the owners may have changed it during the
      // review); run reset first for a fresh set.
      if (await tx.product.findUnique({ where: { id: product.id } })) continue;
      await tx.product.create({
        data: {
          ...product,
          ...(hindi ? { nameHi, descriptionHi } : {}),
          categoryId: categoryIds[category],
        },
      });
      made.products++;
    }

    // One zone per pincode: an existing zone for 800099 is used as it is, never taken over.
    const { pincode, ...zone } = data.zone;
    let served = await tx.deliveryPincode.findUnique({
      where: { pincode },
      include: { zone: true },
    });
    if (!served) {
      await tx.deliveryZone.create({ data: { ...zone, pincodes: { create: { pincode } } } });
      served = await tx.deliveryPincode.findUniqueOrThrow({
        where: { pincode },
        include: { zone: true },
      });
      made.zone++;
    } else if (served.zoneId !== zone.id)
      log(`Pincode ${pincode} already belongs to zone "${served.zone.name}"; left unchanged.`);
    const deliveryZone = served.zone;

    const addresses = {};
    for (const { address, ...customer } of data.customers) {
      const owner = await tx.user.findUnique({ where: { phone: customer.phone } });
      if (owner && owner.id !== customer.id)
        throw new Error(`${customer.phone} belongs to an account prepare did not create.`);
      if (!owner) made.customers++;
      await tx.user.upsert({
        where: { id: customer.id },
        update: {},
        create: { ...customer, role: 'CUSTOMER' },
      });
      addresses[customer.id] = await tx.address.upsert({
        where: { id: address.id },
        update: {},
        create: { ...address, userId: customer.id },
      });
    }

    for (const spec of data.orders) {
      if (await tx.order.findUnique({ where: { id: spec.id } })) continue;
      const userId = spec.customer;
      const address = addresses[userId];
      const createdAt = hours(spec.hoursAgo);
      const items = [];
      for (const line of spec.lines) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        items.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          packSize: product.packSize,
          quantity: line.quantity,
          pricePaise: product.pricePaise,
          priceVersion: product.priceVersion,
          lineTotalPaise: product.pricePaise * line.quantity,
        });
      }
      const amounts = totals(
        items,
        deliveryZone.deliveryFeePaise,
        deliveryZone.freeDeliveryAbovePaise,
      );
      const deliveryDate = istDate(spec.deliveryInDays);
      const notes = 'Sample order for the family review — not a real customer.';
      // The same snapshot shape OrdersService.review stores, so the desk reads it normally.
      const review = await tx.checkoutReview.create({
        data: {
          id: `${spec.id}-review`,
          userId,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 300000),
          snapshot: JSON.parse(
            JSON.stringify({
              addressId: address.id,
              deliveryDate,
              notes,
              paymentMethod: 'COD',
              address,
              items,
              ...amounts,
              deliveryZoneId: deliveryZone.id,
              deliveryZoneVersion: deliveryZone.version,
              deliveryEstimate: deliveryZone.estimate,
              settingsVersion: settings.version,
              changes: [],
            }),
          ),
        },
      });
      // Like a placed order, the sample order holds its stock (without a ledger entry, see above).
      for (const item of items) await takeStock(tx, item.productId, item.quantity);
      const path = statusPath[spec.status];
      // Steps are spread evenly between placing the order and now.
      const at = (step) =>
        new Date(createdAt.getTime() + (step * (Date.now() - createdAt.getTime())) / path.length);
      const delivered = spec.status === 'DELIVERED';
      const order = await tx.order.create({
        data: {
          id: spec.id,
          number: spec.number,
          userId,
          reviewId: review.id,
          idempotencyKey: spec.idempotencyKey,
          status: spec.status,
          address: JSON.parse(JSON.stringify(address)),
          deliveryDate,
          notes,
          ...amounts,
          createdAt,
          // A new order waits for the owners to acknowledge it (and alerts them like a real one);
          // orders already moving were acknowledged and alerted at the time.
          work: {
            create: {
              id: `${spec.id}-work`,
              createdAt,
              ...(path.length > 1 ? { acknowledgedAt: at(1), deliveredAt: createdAt } : {}),
            },
          },
          items: { create: items },
          payment: {
            create: {
              method: 'COD',
              amountPaise: amounts.totalPaise,
              status: delivered ? 'CAPTURED' : 'PENDING',
              createdAt,
            },
          },
          history: {
            create: path.map((status, step) => ({
              status,
              actorId: step ? DEMO_ACTOR : userId,
              note: step ? '' : 'Cash on delivery order placed.',
              createdAt: at(step),
            })),
          },
        },
      });
      // The customer's inbox: "order received", then one update per later step.
      await tx.notification.createMany({
        data: path.map((status, step) => ({
          id: `${spec.id}-notice-${step}`,
          userId,
          orderId: order.id,
          createdAt: at(step),
          read: step < path.length - 1,
          ...(step
            ? {
                title: 'ऑर्डर अपडेट / Order updated',
                body: `${order.number}: ${orderStatusText(status, 'hi')} / ${orderStatusText(status, 'en')}`,
              }
            : { title: 'Order received', body: `${order.number} has been placed.` }),
        })),
      });
      made.orders++;
    }

    const spec = data.quote;
    if (!(await tx.quote.findUnique({ where: { id: spec.id } }))) {
      const createdAt = hours(spec.hoursAgo);
      const items = [];
      for (const line of spec.lines) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        items.push({
          productId: product.id,
          quantity: line.quantity,
          name: product.name,
          unit: product.unit,
          packSize: product.packSize,
        });
      }
      // Awaiting a price: REQUESTED, revision 0 and no unit prices, as QuotesController.request saves.
      await tx.quote.create({
        data: {
          id: spec.id,
          number: spec.number,
          userId: spec.customer,
          address: JSON.parse(JSON.stringify(addresses[spec.customer])),
          deliveryDate: istDate(spec.deliveryInDays),
          company: spec.company,
          gstin: spec.gstin,
          notes: spec.notes,
          createdAt,
          work: { create: { id: `${spec.id}-work`, createdAt } },
          items: { create: items },
        },
      });
      made.quotes++;
    }
  }, transaction);
  return made;
}

/**
 * Removes the sample rows and anything the demo customers did during the review (sign-ins, new
 * orders, quotes). Other people's data is never deleted, and neither are the permanent stock and
 * money ledgers or audit evidence: whatever those still point at is kept and reported instead. A
 * sample product kept this way is hidden from customers. For a complete rollback, restore the
 * snapshot taken before prepare.
 */
export async function reset(db, { log = console.log } = {}) {
  const data = sampleData();
  const removed = {};
  const kept = { orders: 0, products: 0, customers: 0 };
  const count = (name, result) => (removed[name] = (removed[name] || 0) + result.count);
  await db.$transaction(async (tx) => {
    const customers = await tx.user.findMany({
      where: {
        id: { in: data.customers.map((c) => c.id) },
        phone: { startsWith: DEMO_PHONE_PREFIX },
      },
      select: { id: true, phone: true },
    });
    const mine = (ids) => ({
      OR: [{ id: { in: ids } }, { userId: { in: customers.map((u) => u.id) } }],
    });

    // An order whose payment was recorded in the money ledger during the demo stays, with its
    // customer and any quote it came from.
    const all = await tx.order.findMany({
      where: mine(data.orders.map((o) => o.id)),
      select: {
        id: true,
        userId: true,
        quoteId: true,
        reviewId: true,
        payment: { select: { id: true, _count: { select: { movements: true } } } },
      },
    });
    const locked = all.filter((o) => o.payment?._count.movements);
    const orders = all.filter((o) => !locked.includes(o));
    kept.orders = locked.length;
    const users = customers.filter((u) => !locked.some((o) => o.userId === u.id));
    kept.customers = customers.length - users.length;
    const userIds = users.map((u) => u.id);
    const quotes = (
      await tx.quote.findMany({ where: mine([data.quote.id]), select: { id: true } })
    ).filter((q) => !locked.some((o) => o.quoteId === q.id));
    const orderIds = orders.map((o) => o.id);
    const quoteIds = quotes.map((q) => q.id);
    const paymentIds = orders.flatMap((o) => (o.payment ? [o.payment.id] : []));
    const workIds = (
      await tx.ownerWork.findMany({
        where: { OR: [{ orderId: { in: orderIds } }, { quoteId: { in: quoteIds } }] },
        select: { id: true },
      })
    ).map((w) => w.id);

    // Owner alerts about this work (desk notifications and WhatsApp copies).
    for (const id of workIds) {
      count(
        'notifications',
        await tx.notification.deleteMany({ where: { dedupeKey: { startsWith: `owner:${id}:` } } }),
      );
      count(
        'outboundMessages',
        await tx.outboundMessage.deleteMany({
          where: { dedupeKey: { startsWith: `wa:owner:${id}:` } },
        }),
      );
    }
    for (const id of orderIds)
      count(
        'outboundMessages',
        await tx.outboundMessage.deleteMany({
          where: { dedupeKey: { startsWith: `wa:status:${id}:` } },
        }),
      );
    count(
      'notifications',
      await tx.notification.deleteMany({ where: { orderId: { in: orderIds } } }),
    );
    count(
      'payments',
      await tx.paymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } }),
    );
    count('payments', await tx.payment.deleteMany({ where: { id: { in: paymentIds } } }));
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.deliveryAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.ownerWork.deleteMany({ where: { id: { in: workIds } } });
    count('orders', await tx.order.deleteMany({ where: { id: { in: orderIds } } }));
    await tx.checkoutReview.deleteMany({
      where: { OR: [{ id: { in: orders.map((o) => o.reviewId) } }, { userId: { in: userIds } }] },
    });
    await tx.quoteItem.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await tx.quoteRevision.deleteMany({ where: { quoteId: { in: quoteIds } } });
    count('quotes', await tx.quote.deleteMany({ where: { id: { in: quoteIds } } }));

    // A sample product with stock movements (orders, sales or corrections made during the demo),
    // or still used by someone else's records, stays, hidden from customers.
    const productIds = [];
    for (const { id, name } of data.products) {
      if (!(await tx.product.findUnique({ where: { id } }))) continue;
      const used =
        (await tx.inventoryMovement.count({ where: { productId: id } })) +
        (await tx.orderItem.count({ where: { productId: id } })) +
        (await tx.quoteItem.count({ where: { productId: id } })) +
        (await tx.cartItem.count({ where: { productId: id, userId: { notIn: userIds } } })) +
        (await tx.priceUpdateBatchItem.count({ where: { productId: id } }));
      if (used) {
        await tx.product.update({ where: { id }, data: { active: false } });
        log(`Kept "${name}" (hidden): the stock ledger or other records still refer to it.`);
        kept.products++;
      } else productIds.push(id);
    }
    await tx.productPriceHistory.deleteMany({ where: { productId: { in: productIds } } });
    await tx.productAlias.deleteMany({ where: { productId: { in: productIds } } });
    await tx.cartItem.deleteMany({ where: { productId: { in: productIds } } });
    count('products', await tx.product.deleteMany({ where: { id: { in: productIds } } }));
    count(
      'categories',
      await tx.category.deleteMany({
        where: {
          id: { in: data.categories.map((c) => `demo-cat-${c.slug}`) },
          products: { none: {} },
        },
      }),
    );
    count('zone', await tx.deliveryZone.deleteMany({ where: { id: data.zone.id } }));

    count(
      'notifications',
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } }),
    );
    await tx.otpChallenge.deleteMany({ where: { phone: { in: users.map((u) => u.phone) } } });
    // Sessions, addresses, carts, devices and outbound messages go with the account (cascade).
    count('customers', await tx.user.deleteMany({ where: { id: { in: userIds } } }));
  }, transaction);
  if (kept.orders || kept.products || kept.customers)
    log(
      `Kept ${JSON.stringify(kept)}: stock and money ledgers are permanent. Restore the snapshot taken before "prepare" to remove them completely.`,
    );
  return { ...removed, kept };
}

function pgTool(name) {
  const dir =
    process.env.PG_BIN ||
    ['/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@16/bin'].find((path) =>
      existsSync(`${path}/${name}`),
    );
  return dir ? `${dir}/${name}` : name;
}
function runPg(name, args, target) {
  const result = spawnSync(pgTool(name), args, {
    env: { ...process.env, ...target.pgEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${name} failed (${result.error?.code || `exit ${result.status}`}). Set PG_BIN to PostgreSQL 16 tools if needed.`,
    );
}

export function snapshot(target, file) {
  if (!file) throw new Error('Usage: demo.mjs snapshot <file>');
  const path = resolve(file);
  if (existsSync(path)) throw new Error(`${path} already exists; choose a new file.`);
  process.umask(0o077);
  runPg(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', '--file', path, target.database],
    target,
  );
  return path;
}

export function restore(target, file, confirmed) {
  if (!file) throw new Error('Usage: demo.mjs restore <file> --yes');
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`${path} does not exist.`);
  if (!confirmed)
    throw new Error(
      `Restoring replaces every table in ${target.label}. Re-run with --yes to confirm.`,
    );
  runPg(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
      '--dbname',
      target.database,
      path,
    ],
    target,
  );
  return path;
}

async function main(argv) {
  const [command, file] = argv.filter((arg) => !arg.startsWith('--'));
  if (!['prepare', 'reset', 'snapshot', 'restore'].includes(command)) {
    console.error(
      'Usage: node scripts/demo.mjs prepare | reset | snapshot <file> | restore <file> --yes',
    );
    process.exitCode = 1;
    return;
  }
  const target = demoTarget(process.env);
  console.log(`Demo target: ${target.label}`);
  if (command === 'snapshot') return console.log(`Snapshot written to ${snapshot(target, file)}`);
  if (command === 'restore')
    return console.log(`Restored from ${restore(target, file, argv.includes('--yes'))}`);
  const { PrismaClient, Prisma } = await import('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: target.url });
  try {
    if (command === 'prepare') {
      const made = await prepare(db, { Prisma });
      console.log(`Sample data ready (new rows: ${JSON.stringify(made)}).`);
      console.log(
        `Practice pincode ${PRACTICE_PINCODE}; demo customers ${DEMO_PHONE_PREFIX}01–03. Run "reset" to remove them.`,
      );
    } else console.log(`Sample data removed: ${JSON.stringify(await reset(db))}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Demo failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });

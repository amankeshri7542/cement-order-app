import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Db } from './db';
import { getConfig } from './config';
import { fail } from './http';

const hour = 3600000;
export const clientIp = (req: { ip?: string; socket: { remoteAddress?: string } }) =>
  req.ip || req.socket.remoteAddress || 'unknown';

// All callers use SERIALIZABLE transactions: shared budget rows also serialize competing demand.
export async function budget(
  tx: Prisma.TransactionClient,
  scope: string,
  subject: string,
  limit: number,
  duration = hour,
) {
  const digest = createHmac('sha256', getConfig().OTP_HASH_SECRET)
    .update(`${scope}:${subject}`)
    .digest('hex');
  const key = `budget:${scope}:${digest}`;
  const now = new Date();
  const old = await tx.authRateLimit.findUnique({ where: { key } });
  const fresh = !old || old.expiresAt <= now;
  const count = fresh ? 1 : old.count + 1;
  if (count > limit)
    fail(
      'RESOURCE_LIMIT',
      'अभी सीमा पूरी है। कुछ देर बाद कोशिश करें या दुकान से बात करें। / Limit reached; try later or contact the store.',
      429,
    );
  await tx.authRateLimit.upsert({
    where: { key },
    create: { key, count, expiresAt: new Date(now.getTime() + duration) },
    update: { count, ...(fresh ? { expiresAt: new Date(now.getTime() + duration) } : {}) },
  });
  if (count === Math.max(1, Math.ceil(limit * 0.8))) {
    console.warn(
      JSON.stringify({ event: 'SECURITY_BUDGET_WARNING', scope, count, limit, duration }),
    );
    await tx.auditLog.create({
      data: {
        actorId: 'system',
        event: 'SECURITY_BUDGET_WARNING',
        entityId: scope,
        details: { count, limit, duration },
      },
    });
  }
}

export async function requestBudget(
  tx: Prisma.TransactionClient,
  kind: 'order' | 'quote' | 'review',
  userId: string,
  ip: string,
) {
  const c = getConfig();
  if (c.DEMAND_PAUSED)
    fail(
      'DEMAND_PAUSED',
      'नई बुकिंग रुकी है। दुकान से बात करें। / New requests are paused; contact the store.',
      503,
    );
  const limit =
    kind === 'order'
      ? c.ORDERS_PER_ACCOUNT_HOUR
      : kind === 'quote'
        ? c.QUOTES_PER_ACCOUNT_HOUR
        : 60;
  await budget(tx, `${kind}:account`, userId, limit);
  await budget(tx, `${kind}:ip`, ip, limit * 5);
  await budget(
    tx,
    `${kind}:global`,
    'store',
    kind === 'review' ? c.DEMAND_PER_DAY * 10 : c.DEMAND_PER_DAY,
    24 * hour,
  );
}

export const pendingCod: Prisma.OrderWhereInput = {
  status: 'CONFIRMED',
  payment: { method: 'COD', status: 'PENDING' },
  OR: [{ work: null }, { work: { acknowledgedAt: null } }],
};
export const pendingQuote: Prisma.QuoteWhereInput = {
  status: 'REQUESTED',
  OR: [{ work: null }, { work: { acknowledgedAt: null } }],
};

export async function demand(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: 'ORDER' | 'QUOTE',
  totalPaise = 0,
  items: { productId: string; quantity: number }[] = [],
) {
  const c = getConfig();
  const override = await tx.demandOverride.findFirst({
    where: {
      userId,
      kind,
      usedAt: null,
      expiresAt: { gt: new Date() },
      maxTotalPaise: { gte: totalPaise },
    },
    orderBy: { expiresAt: 'asc' },
  });
  if (override) {
    await tx.demandOverride.update({ where: { id: override.id }, data: { usedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        event: 'DEMAND_OVERRIDE_USED',
        entityId: override.id,
        details: { kind, totalPaise },
      },
    });
    return;
  }
  const message =
    'दुकान को पहले अनुरोध जाँचने दें। बड़ी मात्रा के लिए थोक भाव माँगें या दुकान से बात करें। / Pending demand needs owner review. For wholesale, request a quotation or contact the store.';
  const reject = () => fail('DEMAND_REVIEW_REQUIRED', message, 429);
  if (kind === 'QUOTE') {
    if (
      (await tx.quote.count({ where: { ...pendingQuote, userId } })) >= c.PENDING_QUOTES_CUSTOMER ||
      (await tx.quote.count({ where: pendingQuote })) >= c.PENDING_QUOTES_STORE
    )
      reject();
    return;
  }
  const own = await tx.order.aggregate({
    where: { ...pendingCod, userId },
    _count: true,
    _sum: { totalPaise: true },
  });
  const all = await tx.order.aggregate({
    where: pendingCod,
    _count: true,
    _sum: { totalPaise: true },
  });
  if (
    own._count >= c.PENDING_COD_CUSTOMER ||
    all._count >= c.PENDING_COD_STORE ||
    (own._sum.totalPaise || 0) + totalPaise > c.PENDING_COD_CUSTOMER_PAISE ||
    (all._sum.totalPaise || 0) + totalPaise > c.PENDING_COD_STORE_PAISE
  )
    reject();
  for (const item of items) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
    const held = await tx.orderItem.aggregate({
      where: { productId: item.productId, order: pendingCod },
      _sum: { quantity: true },
    });
    const quantity = held._sum.quantity || 0;
    if (
      quantity + item.quantity >
      Math.max(
        product.minQuantity,
        Math.floor(((product.stock + quantity) * c.PENDING_COD_STOCK_PERCENT) / 100),
      )
    )
      reject();
  }
}

export async function leased<T>(
  db: Db,
  resource: string,
  limit: number,
  duration: number,
  run: () => Promise<T>,
) {
  const key = `lease:${resource}:${randomUUID()}`;
  await db.atomic(async (tx) => {
    if (
      (await tx.authRateLimit.count({
        where: { key: { startsWith: `lease:${resource}:` }, expiresAt: { gt: new Date() } },
      })) >= limit
    )
      fail('RESOURCE_BUSY', 'Service is busy. Please try again shortly.', 429);
    await tx.authRateLimit.create({
      data: { key, count: 1, expiresAt: new Date(Date.now() + duration) },
    });
  });
  try {
    return await run();
  } finally {
    await db.authRateLimit.deleteMany({ where: { key } });
  }
}

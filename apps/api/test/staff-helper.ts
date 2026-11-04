import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import type { StaffRole } from '@shiv/shared';

/**
 * Fixtures create staff directly, so they call this to give them what the migration gives existing
 * staff: an owner membership, and desk sessions. Rights come only from memberships.
 */
export async function grantOwners(db: PrismaClient) {
  await db.$executeRaw`
    INSERT INTO "StaffMembership" ("id", "userId", "locationId", "role", "grantedById")
    SELECT 'mbr_' || u."id", u."id", NULL, 'OWNER', u."id" FROM "User" u
    WHERE u."role" = 'ADMIN' AND NOT EXISTS (
      SELECT 1 FROM "StaffMembership" m WHERE m."userId" = u."id" AND m."endedAt" IS NULL
    )`;
  await db.$executeRaw`
    UPDATE "Session" SET "surface" = 'DESK'
    WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'ADMIN')`;
}

export const tokenFor = (id: string) =>
  id
    .replace(/[^a-z0-9]/gi, '')
    .padEnd(43, 'x')
    .slice(0, 43);

type Person = {
  id: string;
  phone: string;
  /** Membership role; leave out for a plain customer. */
  role?: StaffRole;
  /** Shops for a shop role. All-shop roles leave this out. */
  shops?: string[];
  surface?: 'CUSTOMER' | 'DESK';
};

/** Creates someone with a live session, so a test can act as them with tokenFor(id). */
export async function addPerson(db: PrismaClient, person: Person) {
  const { id, phone, role, shops, surface } = person;
  await db.user.create({
    data: {
      id,
      phone,
      name: id,
      role: role ? 'ADMIN' : 'CUSTOMER',
      sessions: {
        create: {
          accessHash: createHash('sha256').update(tokenFor(id)).digest('hex'),
          refreshHash: createHash('sha256').update(`${id}-refresh`).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 86400000),
          surface: surface ?? (role ? 'DESK' : 'CUSTOMER'),
        },
      },
    },
  });
  if (role)
    await db.staffMembership.createMany({
      data: (shops ?? [null]).map((locationId) => ({
        userId: id,
        locationId,
        role,
        grantedById: 'fixture',
      })),
    });
}

/** Pakka karo through the real route, as a shop person does, then the message hold is over. */
export async function confirmOrder(
  server: Server,
  db: PrismaClient,
  token: string,
  orderId: string,
) {
  const { version } = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { version: true },
  });
  const response = await request(server)
    .post(`/api/v1/admin/orders/${orderId}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion: version, decisionKey: randomUUID() });
  if (response.status !== 201) throw new Error(`Confirm failed: ${JSON.stringify(response.body)}`);
  return response.body as { holdUntil: string };
}

/** Clears a shop's own work, which is append-only and so needs its guards lifted to be removed. */
export async function clearShopWork(db: PrismaClient) {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "ApprovalRequest", "StockCountLine", "StockCount", "StockTransferLine", "StockTransfer" CASCADE',
  );
  await db.$executeRawUnsafe('ALTER TABLE "DayClose" DISABLE TRIGGER day_close_append_only');
  await db.$executeRawUnsafe('ALTER TABLE "GallaEntry" DISABLE TRIGGER galla_entry_append_only');
  await db.$executeRawUnsafe('TRUNCATE TABLE "DayClose", "GallaEntry" CASCADE');
  await db.$executeRawUnsafe('ALTER TABLE "DayClose" ENABLE TRIGGER day_close_append_only');
  await db.$executeRawUnsafe('ALTER TABLE "GallaEntry" ENABLE TRIGGER galla_entry_append_only');
}

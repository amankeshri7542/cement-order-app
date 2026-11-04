import { Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, StaffRole } from '@prisma/client';
import {
  locationCreateSchema,
  locationUpdateSchema,
  needsShop,
  staffActionSchema,
  staffUserCreateSchema,
  staffUserUpdateSchema,
} from '@shiv/shared';
import { z } from 'zod';
import { Db } from './db';
import { AuthRequest, Can, Contract, fail, Input, MAIN_LOCATION } from './http';
import { requireStepUp } from './security';
import { randomUUID } from 'node:crypto';
import { t, type Language, type MessageKey } from '@shiv/i18n';

const userSelect = {
  id: true,
  name: true,
  phone: true,
  staffPausedAt: true,
  createdAt: true,
  staffMemberships: {
    where: { endedAt: null },
    select: { role: true, locationId: true, startedAt: true },
  },
  sessions: {
    where: { surface: 'DESK' },
    orderBy: { lastSeenAt: 'desc' },
    take: 1,
    select: { lastSeenAt: true },
  },
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function userView({ staffMemberships, sessions, ...user }: UserRow) {
  return {
    ...user,
    role: staffMemberships[0]?.role ?? null,
    locationIds: staffMemberships.flatMap((m) => (m.locationId ? [m.locationId] : [])),
    lastActiveAt: sessions[0]?.lastSeenAt ?? null,
  };
}

/** One role per person. A shop role needs at least one open shop, an all-shop role names none. */
async function chosenShops(
  tx: Prisma.TransactionClient,
  role: StaffRole,
  asked: string[],
): Promise<(string | null)[]> {
  const ids = [...new Set(asked)];
  if (!needsShop(role)) {
    if (ids.length) fail('INVALID_SHOP', 'This role covers every shop, so choose none.');
    return [null];
  }
  if (!ids.length) fail('SHOP_REQUIRED', 'Choose at least one shop for this person.');
  const open = await tx.location.count({ where: { id: { in: ids }, active: true } });
  if (open !== ids.length) fail('INVALID_SHOP', 'One of those shops is not open on this system.');
  return ids;
}

/** Stops the shop being locked out of its own system. */
async function keepAnotherOwner(tx: Prisma.TransactionClient, userId: string) {
  const others = await tx.staffMembership.count({
    where: {
      role: 'OWNER',
      endedAt: null,
      userId: { not: userId },
      user: { role: 'ADMIN', deletedAt: null, staffPausedAt: null },
    },
  });
  if (!others) fail('LAST_OWNER', 'This is the only owner. Add another owner first.', 409);
}

async function isOwner(tx: Prisma.TransactionClient, userId: string) {
  return !!(await tx.staffMembership.findFirst({
    where: { userId, role: 'OWNER', endedAt: null },
    select: { id: true },
  }));
}

function notSelf(req: AuthRequest, id: string) {
  // Nobody raises their own access, and nobody locks themselves out by accident.
  if (req.user.id === id)
    fail('SELF_CHANGE', 'Your own access can only be changed by another owner.', 403);
}

async function staffMember(tx: Prisma.TransactionClient, id: string) {
  const user = await tx.user.findFirst({
    where: { id, deletedAt: null, staffMemberships: { some: { endedAt: null } } },
  });
  if (!user) fail('NOT_FOUND', 'That person is not on the staff list.', 404);
  return user;
}

/** A second owner hears about access changes, so a stolen phone cannot act unseen. */
export async function tellOtherOwners(
  tx: Prisma.TransactionClient,
  actorId: string,
  message: MessageKey,
  name: string,
) {
  const owners = await tx.user.findMany({
    where: {
      id: { not: actorId },
      role: 'ADMIN',
      deletedAt: null,
      staffPausedAt: null,
      staffMemberships: { some: { role: 'OWNER', endedAt: null } },
    },
    select: { id: true, language: true },
  });
  if (owners.length)
    await tx.notification.createMany({
      data: owners.map((owner) => ({
        userId: owner.id,
        title: t('owner.alert.accessChanged', {}, owner.language as Language),
        body: t(message, { name }, owner.language as Language),
        dedupeKey: `people:${randomUUID()}`,
      })),
    });
}

async function endAccess(tx: Prisma.TransactionClient, userId: string) {
  // Their rights go on the next request whatever happens here. This also ends the open sessions,
  // and a phone that is signed out stops receiving alerts about customers.
  const ended = await tx.session.deleteMany({ where: { userId, surface: { not: 'CUSTOMER' } } });
  await tx.pushSubscription.deleteMany({ where: { userId } });
  await tx.pushActionToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return ended.count;
}

@ApiTags('People and access')
@Controller('admin')
export class UsersController {
  constructor(@Inject(Db) private db: Db) {}

  private stepUp(req: AuthRequest, passphrase?: string) {
    return requireStepUp(this.db, req.user.id, passphrase);
  }

  @Can('staff.manage') @Get('users') async list() {
    const users = await this.db.user.findMany({
      where: { deletedAt: null, staffMemberships: { some: { endedAt: null } } },
      select: userSelect,
      orderBy: { createdAt: 'asc' },
    });
    return users.map(userView);
  }

  @Can('staff.manage')
  @Post('users')
  @Contract(staffUserCreateSchema)
  async create(
    @Input(staffUserCreateSchema) body: z.infer<typeof staffUserCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    await this.stepUp(req, body.passphrase);
    return this.db.atomic(async (tx) => {
      const shops = await chosenShops(tx, body.role, body.locationIds);
      const existing = await tx.user.findUnique({
        where: { phone: body.phone },
        include: { staffMemberships: { where: { endedAt: null }, select: { id: true } } },
      });
      if (existing?.deletedAt)
        fail('ACCOUNT_DELETED', 'This number belongs to a deleted account.', 409);
      if (existing?.staffMemberships.length)
        fail('ALREADY_STAFF', 'This number is already on the staff list.', 409);
      // Customer lists leave staff out, so an open balance would quietly vanish from them.
      if (existing?.khataBalancePaise)
        fail('HAS_UDHAAR', 'Settle this customer’s udhaar before giving them staff access.', 409);
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { role: 'ADMIN', name: body.name, staffPausedAt: null },
          })
        : await tx.user.create({
            data: { phone: body.phone, name: body.name, role: 'ADMIN', language: 'hi' },
          });
      // Anything left from before starts again with a fresh sign-in. Their customer app carries on.
      await tx.session.deleteMany({ where: { userId: user.id, surface: { not: 'CUSTOMER' } } });
      await tx.staffMembership.createMany({
        data: shops.map((locationId) => ({
          userId: user.id,
          locationId,
          role: body.role,
          grantedById: req.user.id,
        })),
      });
      if (body.role === 'OWNER')
        await tellOtherOwners(tx, req.user.id, 'owner.alert.ownerAdded', body.name);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STAFF_ROLE_GRANTED',
          entityId: user.id,
          details: { role: body.role, locationIds: shops.filter(Boolean) },
        },
      });
      return userView(
        await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect }),
      );
    });
  }

  @Can('staff.manage')
  @Patch('users/:id')
  @Contract(staffUserUpdateSchema)
  async update(
    @Param('id') id: string,
    @Input(staffUserUpdateSchema) body: z.infer<typeof staffUserUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    const accessChanging = body.role !== undefined || body.locationIds !== undefined;
    if (accessChanging) {
      notSelf(req, id);
      await this.stepUp(req, body.passphrase);
    }
    return this.db.atomic(async (tx) => {
      const user = await staffMember(tx, id);
      const current = await tx.staffMembership.findMany({ where: { userId: id, endedAt: null } });
      const role = body.role ?? current[0]!.role;
      if (accessChanging) {
        const shops = await chosenShops(
          tx,
          role,
          body.locationIds ?? current.flatMap((m) => (m.locationId ? [m.locationId] : [])),
        );
        if (current.some((m) => m.role === 'OWNER') && role !== 'OWNER')
          await keepAnotherOwner(tx, id);
        const same = (m: (typeof current)[number]) =>
          m.role === role && shops.includes(m.locationId);
        const ending = current.filter((m) => !same(m));
        const adding = shops.filter(
          (locationId) => !current.some((m) => m.role === role && m.locationId === locationId),
        );
        if (ending.length)
          await tx.staffMembership.updateMany({
            where: { id: { in: ending.map((m) => m.id) } },
            data: { endedAt: new Date(), endedById: req.user.id },
          });
        if (adding.length)
          await tx.staffMembership.createMany({
            data: adding.map((locationId) => ({
              userId: id,
              locationId,
              role,
              grantedById: req.user.id,
            })),
          });
        // A role that reaches everything starts with a sign-in that can ask for its passphrase.
        const reachesAll = (name: StaffRole) => name === 'OWNER' || name === 'ACCOUNTANT';
        if (reachesAll(role) && !current.some((m) => reachesAll(m.role))) {
          await tx.session.deleteMany({ where: { userId: id, surface: { not: 'CUSTOMER' } } });
        }
        if (role === 'OWNER' && !current.some((m) => m.role === 'OWNER'))
          await tellOtherOwners(tx, req.user.id, 'owner.alert.ownerAdded', user.name);
        if (ending.length || adding.length)
          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              event: 'STAFF_ROLE_CHANGED',
              entityId: id,
              details: {
                role,
                previousRole: current[0]!.role,
                locationIds: shops.filter(Boolean),
              },
            },
          });
      }
      if (body.name) {
        await tx.user.update({ where: { id }, data: { name: body.name } });
        await tx.auditLog.create({
          data: { actorId: req.user.id, event: 'STAFF_RENAMED', entityId: id, details: {} },
        });
      }
      return userView(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
    });
  }

  @Can('staff.manage')
  @Post('users/:id/pause')
  async pause(
    @Param('id') id: string,
    @Input(staffActionSchema) body: z.infer<typeof staffActionSchema>,
    @Req() req: AuthRequest,
  ) {
    notSelf(req, id);
    await this.stepUp(req, body.passphrase);
    return this.db.atomic(async (tx) => {
      const user = await staffMember(tx, id);
      if (await isOwner(tx, id)) {
        await keepAnotherOwner(tx, id);
        await tellOtherOwners(tx, req.user.id, 'owner.alert.ownerPaused', user.name);
      }
      await tx.user.update({ where: { id }, data: { staffPausedAt: new Date() } });
      await endAccess(tx, id);
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'STAFF_PAUSED', entityId: id, details: {} },
      });
      return userView(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
    });
  }

  @Can('staff.manage')
  @Post('users/:id/resume')
  async resume(
    @Param('id') id: string,
    @Input(staffActionSchema) body: z.infer<typeof staffActionSchema>,
    @Req() req: AuthRequest,
  ) {
    notSelf(req, id);
    await this.stepUp(req, body.passphrase);
    return this.db.atomic(async (tx) => {
      await staffMember(tx, id);
      await tx.user.update({ where: { id }, data: { staffPausedAt: null } });
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'STAFF_RESUMED', entityId: id, details: {} },
      });
      return userView(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
    });
  }

  /** The person leaves the staff list. Their name stays on everything they did. */
  @Can('staff.manage')
  @Post('users/:id/remove')
  async remove(
    @Param('id') id: string,
    @Input(staffActionSchema) body: z.infer<typeof staffActionSchema>,
    @Req() req: AuthRequest,
  ) {
    notSelf(req, id);
    await this.stepUp(req, body.passphrase);
    return this.db.atomic(async (tx) => {
      const user = await staffMember(tx, id);
      if (await isOwner(tx, id)) {
        await keepAnotherOwner(tx, id);
        await tellOtherOwners(tx, req.user.id, 'owner.alert.ownerRemoved', user.name);
      }
      await tx.staffMembership.updateMany({
        where: { userId: id, endedAt: null },
        data: { endedAt: new Date(), endedById: req.user.id },
      });
      await tx.user.update({
        where: { id },
        data: {
          role: user.contractorStatus === 'VERIFIED' ? 'CONTRACTOR' : 'CUSTOMER',
          staffPausedAt: null,
        },
      });
      await endAccess(tx, id);
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'STAFF_REMOVED', entityId: id, details: {} },
      });
      return { ok: true };
    });
  }

  @Can('staff.manage')
  @Post('users/:id/sign-out')
  signOut(@Param('id') id: string, @Req() req: AuthRequest) {
    // On this phone, sign out from Devices instead, so this cannot end the session it runs in.
    notSelf(req, id);
    return this.db.atomic(async (tx) => {
      await staffMember(tx, id);
      const ended = await endAccess(tx, id);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STAFF_SIGNED_OUT',
          entityId: id,
          details: { sessions: ended },
        },
      });
      return { ok: true, sessions: ended };
    });
  }

  @Can('location.manage') @Get('locations') locations() {
    return this.db.location.findMany({
      select: {
        id: true,
        name: true,
        active: true,
        stockStartedAt: true,
        managerRateCapPercent: true,
        _count: { select: { memberships: { where: { endedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Can('location.manage')
  @Post('locations')
  @Contract(locationCreateSchema)
  createLocation(
    @Input(locationCreateSchema) body: z.infer<typeof locationCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const taken = await tx.location.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (taken) fail('SHOP_EXISTS', 'A shop with this name already exists.', 409);
      const base =
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'shop';
      const count = await tx.location.count();
      const location = await tx.location.create({
        // Counted from nothing: stock arrives here as goods received.
        data: {
          firmId: 'firm_main',
          name: body.name,
          slug: `${base}-${count + 1}`,
          stockStartedAt: new Date(),
        },
        select: { id: true, name: true, active: true, stockStartedAt: true },
      });
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'SHOP_ADDED', entityId: location.id, details: {} },
      });
      return location;
    });
  }

  @Can('location.manage')
  @Patch('locations/:id')
  @Contract(locationUpdateSchema)
  updateLocation(
    @Param('id') id: string,
    @Input(locationUpdateSchema) body: z.infer<typeof locationUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const location = await tx.location.findUnique({ where: { id } });
      if (!location) fail('NOT_FOUND', 'That shop could not be found.', 404);
      if (body.active === false) {
        if (id === MAIN_LOCATION)
          fail('SHOP_IN_USE', 'The main shop holds your history and cannot be closed here.', 409);
        const staff = await tx.staffMembership.count({ where: { locationId: id, endedAt: null } });
        if (staff) fail('SHOP_IN_USE', 'Move the staff at this shop first.', 409);
        // Goods on the road would have nowhere to arrive, and nothing can send them back.
        const moving = await tx.stockTransfer.count({
          where: { status: 'SENT', OR: [{ fromLocationId: id }, { toLocationId: id }] },
        });
        if (moving)
          fail('SHOP_IN_USE', 'Receive the goods on the road to or from here first.', 409);
        const counting = await tx.stockCount.count({
          where: { locationId: id, status: { in: ['OPEN', 'SUBMITTED'] } },
        });
        if (counting) fail('SHOP_IN_USE', 'Finish the count going on at this shop first.', 409);
        // Customers ordering in these areas would otherwise be refused at checkout.
        const zones = await tx.deliveryZone.count({ where: { locationId: id, active: true } });
        if (zones) fail('SHOP_IN_USE', 'Move this shop’s delivery areas first.', 409);
        // A cancel or return moves stock back here, which a closed shop would refuse.
        const open = await tx.order.count({
          where: { locationId: id, status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } },
        });
        if (open) fail('SHOP_IN_USE', 'Finish this shop’s open orders first.', 409);
      }
      if (body.name) {
        const taken = await tx.location.findFirst({
          where: { id: { not: id }, name: { equals: body.name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (taken) fail('SHOP_EXISTS', 'A shop with this name already exists.', 409);
      }
      const saved = await tx.location.update({
        where: { id },
        data: body,
        select: {
          id: true,
          name: true,
          active: true,
          stockStartedAt: true,
          managerRateCapPercent: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'SHOP_UPDATED',
          entityId: id,
          details: {
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.managerRateCapPercent === undefined
              ? {}
              : { managerRateCapPercent: body.managerRateCapPercent }),
          },
        },
      });
      return saved;
    });
  }
}

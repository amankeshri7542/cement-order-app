import { Controller, Get, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  canDo,
  deviceDecideSchema,
  phoneSchema,
  qrFresh,
  staffNoticeSchema,
  staffNoticeVersion,
  staffQrProofSchema,
  staffRenewSchema,
  staffVerifySchema,
} from '@shiv/shared';
import { t, readLanguage } from '@shiv/i18n';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuthService, staffAppSessionMs } from '../auth';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  forbid,
  hash,
  Input,
  Public,
  scoped,
  Self,
  shopWhere,
} from '../http';
import {
  makeNonce,
  nonceFresh,
  publicKeyUsable,
  qrGenuine,
  readQr,
  signatureValid,
} from './secret';

type Tx = Prisma.TransactionClient;

/** Tells whoever can decide. The kind of request only: no number or typed reason on a lock screen. */
async function tellDeciders(
  tx: Tx,
  request: { id: string; kind: 'FIRST' | 'CHANGE' },
  userId: string,
) {
  const shops = await tx.staffMembership.findMany({
    where: { userId, endedAt: null, locationId: { not: null } },
    select: { locationId: true },
  });
  const people = await tx.user.findMany({
    where: {
      role: 'ADMIN',
      deletedAt: null,
      staffPausedAt: null,
      id: { not: userId },
      staffMemberships: {
        some: {
          endedAt: null,
          OR: [
            { role: 'OWNER' },
            ...(request.kind === 'FIRST'
              ? [
                  {
                    role: 'MANAGER' as const,
                    locationId: { in: shops.flatMap((row) => row.locationId ?? []) },
                  },
                ]
              : []),
          ],
        },
      },
    },
    select: { id: true, language: true },
  });
  for (const person of people) {
    const language = readLanguage(person.language);
    await tx.notification.create({
      data: {
        userId: person.id,
        dedupeKey: `device:${request.id}:${person.id}`,
        title: t('owner.hazri.phonePushTitle', {}, language),
        body: t(`owner.hazri.phonePush.${request.kind}`, {}, language),
      },
    });
  }
}

/**
 * Ends a phone at once: cutting off can never help a cheat. Its session row stays, so that when it
 * next reaches the server it is told it was cut off, and wipes what it holds.
 */
async function endDevice(
  tx: Tx,
  deviceId: string,
  status: 'REVOKED' | 'REPLACED' | 'LOST',
  actorId: string,
) {
  await tx.staffDevice.update({
    where: { id: deviceId },
    data: { status, revokedAt: new Date(), revokedById: actorId },
  });
}

@Injectable()
export class StaffDevices {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  /** Linking is the only time a code is needed. A number not on the staff can never get in. */
  async verify(body: z.infer<typeof staffVerifySchema>) {
    const parsed = phoneSchema.safeParse(body.phone);
    if (!parsed.success) fail('INVALID_INPUT', 'Check the mobile number.', 400);
    const phone = parsed.data;
    if (!publicKeyUsable(body.publicKey))
      fail('BAD_SIGNATURE', 'This phone cannot be linked.', 400);
    // A public key is not a secret. Naming one proves nothing, so the phone signs with it too.
    if (!signatureValid(body.publicKey, `link-verify|${phone}|${body.code}`, body.signature))
      fail('BAD_SIGNATURE', 'This phone could not prove itself.', 400);
    const challenge = await this.auth.checkCode(phone, body.code);
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    return this.db.atomic(async (tx) => {
      await this.auth.consumeCode(tx, phone, challenge.codeHash);
      const user = await tx.user.findUnique({
        where: { phone },
        include: { staffMemberships: { where: { endedAt: null }, select: { role: true } } },
      });
      if (!user || user.deletedAt || user.staffPausedAt || !user.staffMemberships.length)
        fail('NOT_STAFF', 'This number is not on the staff. Ask the shop to add you.', 403);
      const takenBySomeoneElse = await tx.staffDevice.findFirst({
        where: { publicKey: body.publicKey, status: 'ACTIVE', userId: { not: user.id } },
        select: { id: true },
      });
      if (takenBySomeoneElse)
        fail('DEVICE_TAKEN', 'This phone is already linked to someone else.', 409);
      const active = await tx.staffDevice.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
      });
      let device;
      if (active?.publicKey === body.publicKey) device = active;
      else {
        const pending = await tx.staffDevice.findFirst({
          where: { userId: user.id, status: 'PENDING', publicKey: body.publicKey },
        });
        // A new try from a different phone replaces the request still waiting.
        const older = await tx.deviceLinkRequest.findFirst({
          where: { userId: user.id, status: 'PENDING', deviceId: { not: pending?.id ?? '' } },
        });
        if (older) {
          await tx.deviceLinkRequest.update({
            where: { id: older.id },
            data: { status: 'CANCELLED' },
          });
          await endDevice(tx, older.deviceId, 'REVOKED', user.id);
        }
        device =
          pending ??
          (await tx.staffDevice.create({
            data: {
              userId: user.id,
              publicKey: body.publicKey,
              model: body.model,
              sdk: body.sdk,
            },
          }));
        if (!pending) {
          const everLinked = await tx.staffDevice.count({
            where: { userId: user.id, status: { in: ['ACTIVE', 'REPLACED', 'LOST'] } },
          });
          const request = await tx.deviceLinkRequest.create({
            data: {
              userId: user.id,
              deviceId: device.id,
              kind: everLinked ? 'CHANGE' : 'FIRST',
              reason: body.reason ?? '',
            },
          });
          await tellDeciders(tx, request, user.id);
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              event: 'STAFF_PHONE_ASKED',
              entityId: request.id,
              details: { kind: request.kind },
            },
          });
        }
      }
      await tx.session.deleteMany({ where: { staffDeviceId: device.id } });
      await tx.session.create({
        data: {
          userId: user.id,
          surface: 'STAFF_APP',
          staffDeviceId: device.id,
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          label: body.model.slice(0, 160) || 'Staff app',
          expiresAt: new Date(Date.now() + 1800000),
          refreshExpiresAt: new Date(Date.now() + staffAppSessionMs),
        },
      });
      return {
        accessToken,
        refreshToken,
        device: { id: device.id, status: device.status },
        user: { id: user.id, name: user.name },
      };
    });
  }

  /** A stolen refresh token alone gets nowhere: the renewal must be signed inside the phone. */
  async renew(body: z.infer<typeof staffRenewSchema>) {
    if (!nonceFresh(body.nonce)) fail('UNAUTHORIZED', 'Please sign in again.', 401);
    const presented = hash(body.refreshToken);
    const session = await this.db.session.findFirst({
      where: {
        surface: 'STAFF_APP',
        OR: [{ refreshHash: presented }, { previousRefreshHash: presented }],
      },
      select: { staffDeviceId: true },
    });
    const device = session?.staffDeviceId
      ? await this.db.staffDevice.findUnique({ where: { id: session.staffDeviceId } })
      : null;
    // An unknown token is a sign-in that ran out. Calling it a cut-off makes the phone wipe itself
    // and lose the scans it is holding, so only a phone we know was cut off hears that.
    if (!device) fail('UNAUTHORIZED', 'Please sign in again.', 401);
    if (!['ACTIVE', 'PENDING'].includes(device.status))
      fail('DEVICE_REVOKED', 'This phone is no longer linked.', 401);
    if (!signatureValid(device.publicKey, `renew|${body.nonce}`, body.signature))
      fail('BAD_SIGNATURE', 'This phone could not prove itself.', 401);
    const { accessToken, refreshToken } = await this.auth.refresh(body.refreshToken, true);
    return { accessToken, refreshToken };
  }

  async linkState(req: AuthRequest) {
    const device = req.staffDevice;
    if (!device) fail('NOT_LINKED', 'This works only in the staff app.', 403);
    const request = await this.db.deviceLinkRequest.findFirst({
      where: { deviceId: device.id },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, status: true, qrScannedAt: true, createdAt: true },
    });
    const ack = await this.db.staffNoticeAck.findUnique({
      where: { userId_noticeVersion: { userId: req.user.id, noticeVersion: staffNoticeVersion } },
    });
    return {
      device: { id: device.id, status: device.status },
      request,
      noticeVersion: staffNoticeVersion,
      noticeAccepted: Boolean(ack),
      user: { id: req.user.id, name: req.user.name },
    };
  }

  /** Scanning the shop's code shows the owner that the new phone really was at the shop. */
  async qrProof(body: z.infer<typeof staffQrProofSchema>, req: AuthRequest) {
    const device = req.staffDevice;
    if (!device) fail('NOT_LINKED', 'This works only in the staff app.', 403);
    if (!signatureValid(device.publicKey, `link|${body.qr}`, body.signature))
      fail('BAD_SIGNATURE', 'This phone could not prove itself.', 403);
    const parsed = readQr(body.qr);
    const screen = parsed
      ? await this.db.shopScreen.findUnique({ where: { code: parsed.code } })
      : null;
    if (
      !parsed ||
      !screen ||
      screen.status !== 'ACTIVE' ||
      !qrGenuine(screen, parsed.counter, parsed.mac)
    )
      fail('BAD_QR', 'This is not our shop code.', 400);
    // This is the owner's proof that the new phone stood at the shop, so a photo of an old code fails.
    if (!qrFresh(parsed.counter, Date.now()))
      fail('BAD_QR', 'That code has run out. Scan the screen again.', 400);
    await this.db.deviceLinkRequest.updateMany({
      where: { deviceId: device.id, status: 'PENDING' },
      data: { qrScannedAt: new Date(), qrScreenId: screen.id },
    });
    return { ok: true };
  }

  async acceptNotice(body: z.infer<typeof staffNoticeSchema>, req: AuthRequest) {
    if (body.version !== staffNoticeVersion) fail('INVALID_INPUT', 'Read the latest notice.');
    await this.db.staffNoticeAck.upsert({
      where: { userId_noticeVersion: { userId: req.user.id, noticeVersion: body.version } },
      create: { userId: req.user.id, noticeVersion: body.version },
      update: {},
    });
    return { ok: true };
  }

  /** "Purana phone kho gaya": from any phone after a code. A thief is cut off at once. */
  async reportLost(req: AuthRequest) {
    const device = req.staffDevice;
    if (!device) fail('NOT_LINKED', 'This works only in the staff app.', 403);
    return this.db.atomic(async (tx) => {
      const old = await tx.staffDevice.findFirst({
        where: { userId: req.user.id, status: 'ACTIVE', id: { not: device.id } },
      });
      if (old) {
        await endDevice(tx, old.id, 'LOST', req.user.id);
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'STAFF_PHONE_LOST',
            entityId: old.id,
            details: {},
          },
        });
      }
      return { ok: true, cutOff: Boolean(old) };
    });
  }

  /** Who can decide this: a first phone by a manager of theirs, any change only by an owner. */
  private async mayDecide(
    tx: Pick<Tx, 'staffMembership'>,
    req: AuthRequest,
    request: { kind: string; userId: string },
  ) {
    if (request.userId === req.user.id) return false;
    if (request.kind === 'CHANGE') return canDo(req.access, 'device.approve.change');
    if (canDo(req.access, 'device.approve.change')) return true;
    const shops = await tx.staffMembership.findMany({
      where: { userId: request.userId, endedAt: null },
      select: { locationId: true },
    });
    return shops.some(
      (row) => row.locationId && canDo(req.access, 'device.approve.first', row.locationId),
    );
  }

  async requests(req: AuthRequest) {
    const rows = await this.db.deviceLinkRequest.findMany({
      where: { status: 'PENDING' },
      include: { device: { select: { model: true, sdk: true, createdAt: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, name: true, phone: true },
    });
    const older = await this.db.staffDevice.findMany({
      where: { userId: { in: rows.map((row) => row.userId) }, status: 'ACTIVE' },
      select: { userId: true, model: true, lastSeenAt: true },
    });
    const items = [];
    for (const row of rows) {
      if (!(await this.mayDecide(this.db, req, row))) continue;
      const person = people.find((entry) => entry.id === row.userId);
      const old = older.find((entry) => entry.userId === row.userId);
      items.push({
        id: row.id,
        kind: row.kind,
        reason: row.reason,
        createdAt: row.createdAt,
        qrScannedAt: row.qrScannedAt,
        name: person?.name ?? '',
        phone: person?.phone ?? '',
        model: row.device.model,
        oldModel: old?.model ?? null,
        oldLastSeenAt: old?.lastSeenAt ?? null,
      });
    }
    return { items };
  }

  async decide(id: string, body: z.infer<typeof deviceDecideSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const request = await tx.deviceLinkRequest.findUnique({ where: { id } });
      if (!request) fail('NOT_FOUND', 'That request is not here.', 404);
      if (request.userId === req.user.id)
        fail('OWN_REQUEST', 'Someone else must decide about your phone.', 403);
      if (!(await this.mayDecide(tx, req, request))) forbid(req, 'device.approve.change');
      // A second person sees that it is done, not an error.
      if (request.status !== 'PENDING')
        fail('ALREADY_DECIDED', 'This was already decided.', 409, { status: request.status });
      const approve = body.decision === 'APPROVE';
      if (approve) {
        const old = await tx.staffDevice.findFirst({
          where: { userId: request.userId, status: 'ACTIVE' },
        });
        if (old) await endDevice(tx, old.id, 'REPLACED', req.user.id);
        await tx.staffDevice.update({
          where: { id: request.deviceId },
          data: { status: 'ACTIVE', linkedById: req.user.id },
        });
      } else await endDevice(tx, request.deviceId, 'REVOKED', req.user.id);
      await tx.deviceLinkRequest.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'REFUSED',
          decidedById: req.user.id,
          decidedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: approve ? 'STAFF_PHONE_APPROVED' : 'STAFF_PHONE_REFUSED',
          entityId: id,
          details: { kind: request.kind, userId: request.userId },
        },
      });
      return { id, status: approve ? 'APPROVED' : 'REFUSED' };
    });
  }

  /** "Phone kho gaya: abhi band karo" on a profile. A manager or owner can always cut off. */
  async revoke(userId: string, req: AuthRequest) {
    if (userId === req.user.id) fail('OWN_REQUEST', 'Use your own phone to report it lost.', 403);
    return this.db.atomic(async (tx) => {
      const person = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!person) fail('NOT_FOUND', 'That person could not be found.', 404);
      if (!(await this.mayDecide(tx, req, { kind: 'FIRST', userId })))
        forbid(req, 'device.approve.first');
      const phones = await tx.staffDevice.findMany({
        where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
      });
      for (const phone of phones) await endDevice(tx, phone.id, 'LOST', req.user.id);
      await tx.deviceLinkRequest.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STAFF_PHONE_CUT_OFF',
          entityId: userId,
          details: { phones: phones.length },
        },
      });
      return { ok: true, cutOff: phones.length };
    });
  }

  /** Each person's phone at a glance, for the people pages. */
  async phones(req: AuthRequest) {
    const shops = shopWhere(req, 'device.approve.first');
    const members = await this.db.staffMembership.findMany({
      where: { endedAt: null, ...shops },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((row) => row.userId))];
    const [users, devices, profiles] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, phone: true },
        orderBy: { name: 'asc' },
      }),
      this.db.staffDevice.findMany({
        where: { userId: { in: ids }, status: { in: ['ACTIVE', 'PENDING'] } },
        select: { userId: true, status: true, model: true, lastSeenAt: true },
      }),
      this.db.staffProfile.findMany({ where: { userId: { in: ids } } }),
    ]);
    return {
      items: users.map((user) => ({
        ...user,
        noPhone: profiles.find((row) => row.userId === user.id)?.noPhone ?? false,
        phones: devices.filter((row) => row.userId === user.id),
      })),
    };
  }
}

@ApiTags('Staff app')
@Controller()
export class StaffDevicesController {
  constructor(@Inject(StaffDevices) private devices: StaffDevices) {}

  @Public() @Get('staff-auth/nonce') nonce() {
    return { nonce: makeNonce() };
  }
  @Public()
  @Post('staff-auth/verify')
  @Contract(staffVerifySchema)
  verify(@Input(staffVerifySchema) body: z.infer<typeof staffVerifySchema>) {
    return this.devices.verify(body);
  }
  @Public()
  @Post('staff-auth/renew')
  @Contract(staffRenewSchema)
  renew(@Input(staffRenewSchema) body: z.infer<typeof staffRenewSchema>) {
    return this.devices.renew(body);
  }
  @Self() @Get('staff/me/link') link(@Req() req: AuthRequest) {
    return this.devices.linkState(req);
  }
  @Self()
  @Post('staff/me/notice')
  @Contract(staffNoticeSchema)
  notice(
    @Input(staffNoticeSchema) body: z.infer<typeof staffNoticeSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.devices.acceptNotice(body, req);
  }
  @Self()
  @Post('staff/devices/qr-proof')
  @Contract(staffQrProofSchema)
  proof(
    @Input(staffQrProofSchema) body: z.infer<typeof staffQrProofSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.devices.qrProof(body, req);
  }
  @Self() @Post('staff/devices/lost') lost(@Req() req: AuthRequest) {
    return this.devices.reportLost(req);
  }
  @Can('device.approve.first', scoped) @Get('admin/device-requests') requests(
    @Req() req: AuthRequest,
  ) {
    return this.devices.requests(req);
  }
  @Can('device.approve.first', scoped)
  @Post('admin/device-requests/:id/decide')
  @Contract(deviceDecideSchema)
  decide(
    @Param('id') id: string,
    @Input(deviceDecideSchema) body: z.infer<typeof deviceDecideSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.devices.decide(id, body, req);
  }
  @Can('device.approve.first', scoped) @Post('admin/staff/:id/device/revoke') revoke(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.devices.revoke(id, req);
  }
  @Can('device.approve.first', scoped) @Get('admin/staff-phones') phones(@Req() req: AuthRequest) {
    return this.devices.phones(req);
  }
}

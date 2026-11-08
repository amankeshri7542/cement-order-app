import {
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '@prisma/client';
import {
  attendanceCorrectionSchema,
  attendanceManualSchema,
  attendanceProblemSchema,
  attendancePunchSchema,
  attendanceQuerySchema,
  canDo,
  distanceMeters,
  geoRetentionDays,
  impossibleTravel,
  istToday,
  offlineAfterMs,
  placeOf,
  punchMessage,
  punchVerdict,
  qrCounter,
  qrFresh,
  qrMsLeft,
  qrShownAt,
  reviewBulkSchema,
  reviewDecideSchema,
  reviewEscalatesAfterMs,
  screenCreateSchema,
  screenPairSchema,
  shopSetupSchema,
  staffNoPhoneSchema,
  staffNoticeVersion,
  staffScheduleSchema,
  summarizeDay,
  weakFixWindowDays,
  type Access,
  type DayEvent,
} from '@shiv/shared';
import { t, readLanguage } from '@shiv/i18n';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { budget, budgetUsed } from '../abuse';
import { enqueueWhatsApp } from '../alerts';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  forbid,
  Input,
  Public,
  requireAt,
  scoped,
  Self,
  shopAsked,
  shopForAction,
  shopWhere,
} from '../http';
import { Evidence, evidenceExists } from './evidence';
import { appendEvent, brokenAt, rootOf, streamOf } from './chain';
import { ledgerBrokenAt } from './pay';
import {
  newScreenCode,
  pairingHash,
  qrGenuine,
  qrText,
  readQr,
  seal,
  secretHash,
  signatureValid,
  unseal,
} from './secret';

type Tx = Prisma.TransactionClient;

/**
 * Whether this person holds a permission over a row. A row with no shop (an owner's own, say) is
 * only for those who hold it everywhere: "no shop to check" must never mean "allowed".
 */
const holdsFor = (
  access: Access,
  permission: Parameters<typeof canDo>[1],
  locationId: string | null | undefined,
) => (locationId ? canDo(access, permission, locationId) : access[permission] === 'ALL');

/** Wrong pairing codes in an hour, from anywhere. A person mistypes a few; a machine tries thousands. */
const screenPairGuesses = 50;

const dayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** Which schedule held on a day: the latest one that had started by then. */
async function scheduleOn(tx: Pick<Tx, 'staffSchedule'>, userId: string, day: string) {
  return tx.staffSchedule.findFirst({
    where: { userId, effectiveFrom: { lte: day } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/** An accepted offline scan counts at the time it was taken; both times stay on the record. */
const effectiveAt = (event: {
  serverAt: Date;
  claimedAgeMs: number | null;
  review: string | null;
}) =>
  event.review === 'ACCEPTED' && (event.claimedAgeMs ?? 0) > offlineAfterMs
    ? new Date(event.serverAt.getTime() - event.claimedAgeMs!)
    : event.serverAt;

/** The day is worked out again from the record, so it can never disagree with it. */
export async function rebuildDay(tx: Tx, userId: string, day: string) {
  const from = dayStart(day);
  // A scan carried offline arrives later than it was taken, so look a little past the day.
  const rows = await tx.attendanceEvent.findMany({
    where: {
      userId,
      serverAt: { gte: from, lt: new Date(from.getTime() + 15 * 86400000) },
      kind: { in: ['IN', 'OUT', 'MANUAL_IN', 'MANUAL_OUT', 'CORRECTION'] },
    },
    orderBy: { seq: 'asc' },
  });
  const reviews = await tx.attendanceReview.findMany({
    where: { eventId: { in: rows.map((row) => row.id) } },
    select: { eventId: true, status: true },
  });
  const events: DayEvent[] = [];
  for (const row of rows) {
    const review = reviews.find((entry) => entry.eventId === row.id)?.status ?? null;
    const at = effectiveAt({ ...row, review });
    // A correction belongs to the day it corrects, wherever it was written.
    const owner = row.kind === 'CORRECTION' && row.correctedAt ? row.correctedAt : at;
    if (istToday(owner) !== day) continue;
    events.push({
      id: row.id,
      kind: row.kind,
      serverAt: at,
      locationId: row.locationId,
      result: row.result,
      review,
      correctsKind: row.correctsKind,
      correctedAt: row.correctedAt,
    });
  }
  const schedule = await scheduleOn(tx, userId, day);
  const shopId = events.find((event) => event.locationId)?.locationId;
  const shop = shopId
    ? await tx.location.findUnique({ where: { id: shopId }, select: { graceMinutes: true } })
    : null;
  const summary = summarizeDay(day, events, schedule, shop?.graceMinutes ?? 0);
  const data = { ...summary, day, userId };
  await tx.attendanceDay.upsert({
    where: { userId_day: { userId, day } },
    create: data,
    update: summary,
  });
  return summary;
}

async function assignedAt(tx: Pick<Tx, 'staffMembership'>, userId: string, locationId: string) {
  const row = await tx.staffMembership.findFirst({
    where: { userId, endedAt: null, OR: [{ locationId }, { locationId: null }] },
    select: { id: true },
  });
  return Boolean(row);
}
/** A manager's own attendance goes to an owner, with no way around it. */
async function managesAt(
  tx: Pick<Tx, 'staffMembership'>,
  userId: string,
  locationId: string | null,
) {
  const row = await tx.staffMembership.findFirst({
    where: {
      userId,
      endedAt: null,
      role: 'MANAGER',
      ...(locationId ? { locationId } : {}),
    },
    select: { id: true },
  });
  return Boolean(row);
}
/** Someone with an open arrival today: their next scan is going home. */
async function openArrival(tx: Pick<Tx, 'attendanceEvent'>, userId: string, day: string) {
  const rows = await tx.attendanceEvent.findMany({
    where: {
      userId,
      serverAt: { gte: dayStart(day) },
      kind: { in: ['IN', 'OUT', 'MANUAL_IN', 'MANUAL_OUT'] },
      NOT: { result: 'RETRY' },
    },
    orderBy: { seq: 'desc' },
    take: 1,
  });
  const last = rows[0];
  return last && (last.kind === 'IN' || last.kind === 'MANUAL_IN') ? last : null;
}

@Injectable()
export class Attendance {
  constructor(
    @Inject(Db) private db: Db,
    @Optional() @Inject(Evidence) private evidence?: Evidence,
  ) {}

  /** Writes it down and answers at once. Only a code that is not ours, or an unlinked phone, is refused. */
  async punch(body: z.infer<typeof attendancePunchSchema>, req: AuthRequest) {
    const device = req.staffDevice;
    if (!device || device.status !== 'ACTIVE')
      fail('NOT_LINKED', 'This phone is not linked yet.', 403);
    if (!signatureValid(device.publicKey, punchMessage(body), body.signature))
      fail('BAD_SIGNATURE', 'This phone could not prove itself.', 403);
    const parsed = readQr(body.qr);
    if (!parsed) fail('BAD_QR', 'This is not our shop code.', 400);
    const screen = await this.db.shopScreen.findUnique({
      where: { code: parsed.code },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            lat: true,
            lng: true,
            radiusM: true,
            attendanceOn: true,
            active: true,
          },
        },
      },
    });
    if (!screen || screen.status !== 'ACTIVE' || !qrGenuine(screen, parsed.counter, parsed.mac))
      fail('BAD_QR', 'This is not our shop code.', 400);
    const shop = screen.location;
    if (!shop.active || !shop.attendanceOn)
      fail('ATTENDANCE_OFF', 'Hazri has not started at this shop yet.', 409);
    const userId = req.user.id;
    await this.needsNotice(userId);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.attendanceEvent.findUnique({
        where: { userId_captureId: { userId, captureId: body.captureId } },
      });
      if (earlier) return this.answer(tx, earlier, { replay: true });
      const now = Date.now();
      const day = istToday(new Date(now));
      const open = await openArrival(tx, userId, day);
      // A second arrival is not a mistake to scold: it says when the first one was.
      if (body.kind === 'IN' && open)
        return this.answer(tx, open, { already: true, shopName: shop.name });
      const hasFix = typeof body.lat === 'number' && typeof body.lng === 'number';
      const noPin = shop.lat === null || shop.lng === null;
      const distanceM =
        hasFix && !noPin
          ? distanceMeters({ lat: body.lat!, lng: body.lng! }, { lat: shop.lat!, lng: shop.lng! })
          : null;
      const place = noPin
        ? ('NO_FIX' as const)
        : placeOf(distanceM, hasFix ? (body.accuracyM ?? null) : null, shop.radiusM);
      const lastAtOtherShop = await tx.attendanceEvent.findFirst({
        where: {
          userId,
          locationId: { not: shop.id },
          kind: { in: ['IN', 'OUT'] },
          serverAt: { gte: new Date(now - 12 * 3600000) },
        },
        orderBy: { seq: 'desc' },
      });
      const lastShop = lastAtOtherShop?.locationId
        ? await tx.location.findUnique({
            where: { id: lastAtOtherShop.locationId },
            select: { lat: true, lng: true },
          })
        : null;
      const weakFixesThisWeek = await tx.attendanceEvent.count({
        where: {
          userId,
          reasons: { has: 'WEAK_FIX' },
          serverAt: { gte: new Date(now - weakFixWindowDays * 86400000) },
        },
      });
      const verdict = punchVerdict({
        qrFresh: qrFresh(parsed.counter, now),
        place,
        location: body.location,
        mocked: body.mocked,
        assignedHere: await assignedAt(tx, userId, shop.id),
        offline: (body.claimedAgeMs ?? 0) > offlineAfterMs,
        impossibleTravel: impossibleTravel(
          lastAtOtherShop && lastShop?.lat != null && lastShop.lng != null
            ? { at: lastAtOtherShop.serverAt.getTime(), lat: lastShop.lat, lng: lastShop.lng }
            : null,
          noPin ? null : { at: now, lat: shop.lat!, lng: shop.lng! },
        ),
        weakFixesThisWeek,
        noPin,
      });
      const reasons: string[] = [...verdict.reasons];
      let result = verdict.result;
      // Offline, the phone says when it scanned. The code says when it was on the wall. Both must agree.
      if (
        verdict.reasons.includes('OFFLINE') &&
        Math.abs(now - qrShownAt(parsed.counter) - (body.claimedAgeMs ?? 0)) > 180000
      )
        reasons.push('TIME_MISMATCH');
      // Going home with no arrival on record is still written down, and someone looks.
      if (body.kind === 'OUT' && !open && result !== 'RETRY') {
        reasons.push('NO_IN');
        result = 'REVIEW';
      }
      // Exact position is kept only when someone must judge it. Inside, only the distance.
      const keepPosition =
        hasFix && result === 'REVIEW' && !['INSIDE', 'PLAUSIBLE'].includes(place);
      const sealed = keepPosition ? seal({ lat: body.lat, lng: body.lng }) : null;
      const event = await appendEvent(tx, {
        userId,
        kind: body.kind,
        actorId: userId,
        locationId: shop.id,
        captureId: body.captureId,
        claimedAgeMs: body.claimedAgeMs ?? null,
        bootCount: body.bootCount ?? null,
        appVersion: body.appVersion ?? null,
        deviceId: device.id,
        signature: body.signature,
        qrCounter: parsed.counter,
        screenId: screen.id,
        distanceM,
        accuracyM: hasFix && body.accuracyM !== undefined ? Math.round(body.accuracyM) : null,
        mocked: body.mocked,
        reasons,
        geoHash: sealed ? secretHash(sealed) : null,
        result,
      });
      if (sealed)
        await tx.attendanceGeo.create({
          data: {
            eventId: event.id,
            geoEnc: sealed,
            retainUntil: new Date(now + geoRetentionDays * 86400000),
          },
        });
      if (result === 'REVIEW')
        await tx.attendanceReview.create({
          data: {
            eventId: event.id,
            userId,
            locationId: shop.id,
            kind: reasons[0] ?? 'REVIEW',
            toOwner: await managesAt(tx, userId, shop.id),
          },
        });
      await tx.staffDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return this.answer(tx, event, { shopName: shop.name });
    });
  }

  /** Someone is told what a scan collects before the first one. If they refuse, a manager marks them. */
  private async needsNotice(userId: string) {
    const ack = await this.db.staffNoticeAck.findUnique({
      where: { userId_noticeVersion: { userId, noticeVersion: staffNoticeVersion } },
    });
    if (!ack) fail('NOTICE_NEEDED', 'Read the hazri notice first.', 409);
  }

  private async answer(
    tx: Tx,
    event: {
      id: string;
      userId: string;
      kind: string;
      serverAt: Date;
      result: string | null;
      reasons: string[];
    },
    extra: { replay?: boolean; already?: boolean; shopName?: string },
  ) {
    const day = istToday(event.serverAt);
    const summary = event.result === 'RETRY' ? null : await rebuildDay(tx, event.userId, day);
    return {
      id: event.id,
      kind: event.kind,
      result: event.result,
      reasons: event.reasons,
      serverAt: event.serverAt,
      lateMinutes: event.kind === 'IN' ? (summary?.lateMinutes ?? 0) : 0,
      ...extra,
    };
  }

  /** "Problem hai?" always goes through: the time is written, and a person looks. */
  async problem(body: z.infer<typeof attendanceProblemSchema>, req: AuthRequest) {
    const device = req.staffDevice;
    if (!device || device.status !== 'ACTIVE')
      fail('NOT_LINKED', 'This phone is not linked yet.', 403);
    const userId = req.user.id;
    await this.needsNotice(userId);
    if (body.evidenceId) await evidenceExists(this.db, body.evidenceId, req.user.id);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.attendanceEvent.findUnique({
        where: { userId_captureId: { userId, captureId: body.captureId } },
      });
      if (earlier) return this.answer(tx, earlier, { replay: true });
      const membership = await tx.staffMembership.findFirst({
        where: {
          userId,
          endedAt: null,
          ...(body.locationId ? { locationId: body.locationId } : { locationId: { not: null } }),
        },
        select: { locationId: true },
        orderBy: { startedAt: 'asc' },
      });
      const locationId = body.locationId ?? membership?.locationId ?? null;
      if (body.locationId && !membership && !(await assignedAt(tx, userId, body.locationId)))
        fail('NOT_ASSIGNED', 'You are not at this shop.', 403);
      const hasFix = typeof body.lat === 'number' && typeof body.lng === 'number';
      const sealed = hasFix ? seal({ lat: body.lat, lng: body.lng }) : null;
      const event = await appendEvent(tx, {
        userId,
        kind: body.kind,
        actorId: userId,
        locationId,
        captureId: body.captureId,
        claimedAgeMs: body.claimedAgeMs ?? null,
        deviceId: device.id,
        accuracyM: hasFix && body.accuracyM !== undefined ? Math.round(body.accuracyM) : null,
        reasons: [`PROBLEM_${body.problem}`],
        geoHash: sealed ? secretHash(sealed) : null,
        evidenceId: body.evidenceId ?? null,
        result: 'REVIEW',
        reason: body.note ?? '',
      });
      if (sealed)
        await tx.attendanceGeo.create({
          data: {
            eventId: event.id,
            geoEnc: sealed,
            retainUntil: new Date(Date.now() + geoRetentionDays * 86400000),
          },
        });
      await tx.attendanceReview.create({
        data: {
          eventId: event.id,
          userId,
          locationId,
          kind: `PROBLEM_${body.problem}`,
          toOwner: await managesAt(tx, userId, locationId),
        },
      });
      return this.answer(tx, event, {});
    });
  }

  /** The hazri screen: where this person stands today, with the server's own clock. */
  async today(req: AuthRequest) {
    const userId = req.user.id;
    const day = istToday();
    const [row, memberships, ack, schedule, openReviews] = await Promise.all([
      this.db.attendanceDay.findUnique({ where: { userId_day: { userId, day } } }),
      this.db.staffMembership.findMany({
        where: { userId, endedAt: null },
        select: { role: true, location: { select: { id: true, name: true } } },
      }),
      this.db.staffNoticeAck.findUnique({
        where: { userId_noticeVersion: { userId, noticeVersion: staffNoticeVersion } },
      }),
      scheduleOn(this.db, userId, day),
      this.db.attendanceReview.count({ where: { userId, status: 'OPEN' } }),
    ]);
    const open = await openArrival(this.db, userId, day);
    const shopName = open?.locationId
      ? (
          await this.db.location.findUnique({
            where: { id: open.locationId },
            select: { name: true },
          })
        )?.name
      : undefined;
    return {
      serverNow: new Date(),
      day,
      user: { id: userId, name: req.user.name },
      noticeVersion: staffNoticeVersion,
      noticeAccepted: Boolean(ack),
      roles: [...new Set(memberships.map((entry) => entry.role))],
      shops: memberships.flatMap((entry) => (entry.location ? [entry.location] : [])),
      access: Object.keys(req.access),
      schedule: schedule && {
        startMinute: schedule.startMinute,
        endMinute: schedule.endMinute,
        weeklyOffs: schedule.weeklyOffs,
      },
      next: open ? 'OUT' : 'IN',
      arrivedAt: open?.serverAt ?? null,
      shopName: shopName ?? null,
      status: row?.status ?? 'ABSENT',
      firstInAt: row?.firstInAt ?? null,
      lastOutAt: row?.lastOutAt ?? null,
      minutes: row?.minutes ?? null,
      lateMinutes: row?.lateMinutes ?? 0,
      flags: row?.flags ?? [],
      openReviews,
    };
  }

  /** My record: a person's own month, and nobody else's. */
  async myMonth(month: string, req: AuthRequest) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('BAD_DAY', 'Choose a month.');
    const rows = await this.db.attendanceDay.findMany({
      where: { userId: req.user.id, day: { gte: `${month}-01`, lte: `${month}-31` } },
      orderBy: { day: 'asc' },
    });
    return {
      month,
      days: rows.map((row) => ({
        day: row.day,
        status: row.status,
        firstInAt: row.firstInAt,
        lastOutAt: row.lastOutAt,
        minutes: row.minutes,
        lateMinutes: row.lateMinutes,
        flags: row.flags,
      })),
    };
  }
  async myDay(day: string, req: AuthRequest) {
    if (!z.iso.date().safeParse(day).success) fail('BAD_DAY', 'Choose a day.');
    return { day, events: await this.eventsOf(req.user.id, day) };
  }
  private async eventsOf(userId: string, day: string) {
    const from = dayStart(day);
    // A scan carried offline arrives after it was taken, and a correction can be written days later.
    const nearby = await this.db.attendanceEvent.findMany({
      where: { userId, serverAt: { gte: from, lt: new Date(from.getTime() + 15 * 86400000) } },
      orderBy: { seq: 'asc' },
    });
    const reviews = await this.db.attendanceReview.findMany({
      where: { eventId: { in: nearby.map((row) => row.id) } },
    });
    const dayKinds = ['IN', 'OUT', 'MANUAL_IN', 'MANUAL_OUT', 'CORRECTION'];
    const rows = nearby.filter((row) => {
      if (!dayKinds.includes(row.kind)) return istToday(row.serverAt) === day;
      const review = reviews.find((entry) => entry.eventId === row.id)?.status ?? null;
      const at = effectiveAt({ ...row, review });
      const counts = row.kind === 'CORRECTION' && row.correctedAt ? row.correctedAt : at;
      return istToday(counts) === day;
    });
    const ids = [...new Set(rows.map((row) => row.actorId))];
    const people = await this.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const shops = await this.db.location.findMany({ select: { id: true, name: true } });
    return rows.map((row) => {
      const review = reviews.find((entry) => entry.eventId === row.id);
      return {
        id: row.id,
        kind: row.kind,
        serverAt: row.serverAt,
        claimedAgeMs: row.claimedAgeMs,
        result: row.result,
        reasons: row.reasons,
        distanceM: row.distanceM,
        accuracyM: row.accuracyM,
        mocked: row.mocked,
        reason: row.reason,
        correctsKind: row.correctsKind,
        correctedAt: row.correctedAt,
        shopName: shops.find((shop) => shop.id === row.locationId)?.name ?? '',
        actorName: people.find((person) => person.id === row.actorId)?.name ?? '',
        byHand: row.actorId !== userId,
        review: review ? { status: review.status, note: review.note } : null,
      };
    });
  }

  /** "Kuch galat hai? Batao": it reaches whoever looks at this shop's hazri. */
  async query(body: z.infer<typeof attendanceQuerySchema>, req: AuthRequest) {
    const userId = req.user.id;
    return this.db.atomic(async (tx) => {
      const membership = await tx.staffMembership.findFirst({
        where: { userId, endedAt: null, locationId: { not: null } },
        select: { locationId: true },
      });
      const event = await appendEvent(tx, {
        userId,
        kind: 'SIGNAL',
        actorId: userId,
        locationId: membership?.locationId ?? null,
        reasons: ['QUERY'],
        reason: `${body.day}: ${body.note}`,
      });
      await tx.attendanceReview.create({
        data: {
          eventId: event.id,
          userId,
          locationId: membership?.locationId ?? null,
          kind: 'QUERY',
          toOwner: await managesAt(tx, userId, membership?.locationId ?? null),
        },
      });
      return { ok: true };
    });
  }

  // ---- The desk ---------------------------------------------------------------------------

  async roster(locationId: string, day: string) {
    if (!z.iso.date().safeParse(day).success) fail('BAD_DAY', 'Choose a day.');
    const members = await this.db.staffMembership.findMany({
      where: {
        endedAt: null,
        locationId,
        role: { notIn: ['TECH_OPERATOR'] },
      },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    const ids = members.map((row) => row.userId);
    const [days, phones, profiles, schedules] = await Promise.all([
      this.db.attendanceDay.findMany({ where: { day, userId: { in: ids } } }),
      this.db.staffDevice.findMany({
        where: { userId: { in: ids }, status: 'ACTIVE' },
        select: { userId: true },
      }),
      this.db.staffProfile.findMany({ where: { userId: { in: ids } } }),
      Promise.all(ids.map((id) => scheduleOn(this.db, id, day))),
    ]);
    return {
      day,
      locationId,
      items: members.map((row, index) => {
        const entry = days.find((item) => item.userId === row.userId);
        const schedule = schedules[index];
        const off = schedule?.weeklyOffs.includes(new Date(`${day}T12:00:00Z`).getUTCDay());
        return {
          userId: row.userId,
          name: row.user.name,
          role: row.role,
          status: entry?.status ?? (off ? 'WEEKLY_OFF' : 'ABSENT'),
          firstInAt: entry?.firstInAt ?? null,
          lastOutAt: entry?.lastOutAt ?? null,
          minutes: entry?.minutes ?? null,
          lateMinutes: entry?.lateMinutes ?? 0,
          flags: entry?.flags ?? [],
          linked: phones.some((phone) => phone.userId === row.userId),
          noPhone: profiles.find((item) => item.userId === row.userId)?.noPhone ?? false,
        };
      }),
    };
  }

  async personDay(userId: string, day: string, req: AuthRequest) {
    if (!z.iso.date().safeParse(day).success) fail('BAD_DAY', 'Choose a day.');
    const shops = await this.db.staffMembership.findMany({
      where: { userId, endedAt: null },
      select: { locationId: true },
    });
    if (!shops.some((row) => holdsFor(req.access, 'attendance.read', row.locationId)))
      forbid(req, 'attendance.read');
    return { userId, day, events: await this.eventsOf(userId, day) };
  }

  /** The cards to settle. Nobody ever sees their own, and a manager's own goes up. */
  async reviews(req: AuthRequest, query: Record<string, string>) {
    const owner = req.access['attendance.review'] === 'ALL';
    const rows = await this.db.attendanceReview.findMany({
      where: {
        status: 'OPEN',
        userId: { not: req.user.id },
        ...(owner ? {} : { toOwner: false }),
        ...shopAsked(req, 'attendance.review', query.locationId),
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const events = await this.db.attendanceEvent.findMany({
      where: { id: { in: rows.map((row) => row.eventId) } },
    });
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, name: true },
    });
    const shops = await this.db.location.findMany({ select: { id: true, name: true } });
    const geos = await this.db.attendanceGeo.findMany({
      where: { eventId: { in: rows.map((row) => row.eventId) }, erasedAt: null },
    });
    const month = istToday().slice(0, 7);
    const items = [];
    for (const row of rows) {
      const event = events.find((entry) => entry.id === row.eventId);
      if (!event) continue;
      const geo = geos.find((entry) => entry.eventId === row.eventId);
      const weakThisMonth = await this.db.attendanceEvent.count({
        where: {
          userId: row.userId,
          reasons: { has: 'WEAK_FIX' },
          serverAt: { gte: new Date(`${month}-01T00:00:00+05:30`) },
        },
      });
      items.push({
        id: row.id,
        kind: row.kind,
        toOwner: row.toOwner,
        createdAt: row.createdAt,
        userId: row.userId,
        name: people.find((person) => person.id === row.userId)?.name ?? '',
        shopName: shops.find((shop) => shop.id === row.locationId)?.name ?? '',
        locationId: row.locationId,
        punch: event.kind,
        serverAt: event.serverAt,
        claimedAgeMs: event.claimedAgeMs,
        qrShownAt: event.qrCounter ? new Date(qrShownAt(event.qrCounter)) : null,
        reasons: event.reasons,
        distanceM: event.distanceM,
        accuracyM: event.accuracyM,
        mocked: event.mocked,
        note: event.reason,
        evidenceId: event.evidenceId,
        position: geo?.geoEnc ? unseal<{ lat: number; lng: number }>(geo.geoEnc) : null,
        weakThisMonth,
      });
    }
    return { items, count: items.length };
  }

  private async settle(
    tx: Tx,
    review: { id: string; eventId: string; userId: string; locationId: string | null },
    status: 'ACCEPTED' | 'REJECTED',
    actorId: string,
    note: string,
  ) {
    const moved = await tx.attendanceReview.updateMany({
      where: { id: review.id, status: 'OPEN' },
      data: { status, decidedById: actorId, decidedAt: new Date(), note },
    });
    if (!moved.count) return false;
    await appendEvent(tx, {
      userId: review.userId,
      kind: 'DECISION',
      actorId,
      locationId: review.locationId,
      refersToId: review.eventId,
      reasons: [status],
      reason: note,
    });
    const event = await tx.attendanceEvent.findUniqueOrThrow({ where: { id: review.eventId } });
    await rebuildDay(tx, review.userId, istToday(event.serverAt));
    // An accepted offline scan may belong to the day it was really taken.
    if (status === 'ACCEPTED' && (event.claimedAgeMs ?? 0) > offlineAfterMs)
      await rebuildDay(
        tx,
        review.userId,
        istToday(new Date(event.serverAt.getTime() - event.claimedAgeMs!)),
      );
    return true;
  }

  async decide(id: string, body: z.infer<typeof reviewDecideSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const review = await tx.attendanceReview.findUnique({ where: { id } });
      if (!review) fail('NOT_FOUND', 'That card is not here.', 404);
      if (review.userId === req.user.id)
        fail('OWN_RECORD', 'Someone else must decide about your own hazri.', 403);
      if (!holdsFor(req.access, 'attendance.review', review.locationId))
        forbid(req, 'attendance.review');
      if (review.toOwner && req.access['attendance.review'] !== 'ALL')
        forbid(req, 'attendance.review');
      if (review.status !== 'OPEN')
        fail('ALREADY_DECIDED', 'This was already decided.', 409, { status: review.status });
      if (body.decision === 'TO_OWNER') {
        await tx.attendanceReview.update({ where: { id }, data: { toOwner: true } });
        return { id, status: 'OPEN', toOwner: true };
      }
      const status = body.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      await this.settle(tx, review, status, req.user.id, body.note ?? '');
      return { id, status };
    });
  }

  /** "The shop's network was down": many at once, with one reason for all of them. */
  async bulk(body: z.infer<typeof reviewBulkSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const rows = await tx.attendanceReview.findMany({ where: { id: { in: body.ids } } });
      let accepted = 0;
      for (const review of rows) {
        // Skips rather than fails: one's own card or another shop's must not stop the rest.
        if (review.userId === req.user.id || review.status !== 'OPEN') continue;
        if (!holdsFor(req.access, 'attendance.review', review.locationId)) continue;
        if (review.toOwner && req.access['attendance.review'] !== 'ALL') continue;
        if (await this.settle(tx, review, 'ACCEPTED', req.user.id, body.note)) accepted++;
      }
      return { accepted };
    });
  }

  /** For someone with no phone or a broken one. Only at the time now: no backdating, ever. */
  async manual(body: z.infer<typeof attendanceManualSchema>, req: AuthRequest) {
    requireAt(req, 'attendance.mark', body.locationId);
    if (body.userId === req.user.id)
      fail('OWN_RECORD', 'Someone else must mark your own hazri.', 403);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.attendanceEvent.findUnique({
        where: { userId_captureId: { userId: body.userId, captureId: body.idempotencyKey } },
      });
      if (earlier) return this.answer(tx, earlier, { replay: true });
      if (!(await assignedAt(tx, body.userId, body.locationId)))
        fail('NOT_ASSIGNED', 'This person is not at this shop.', 409);
      const day = istToday();
      const open = await openArrival(tx, body.userId, day);
      if (body.kind === 'MANUAL_IN' && open) return this.answer(tx, open, { already: true });
      if (body.kind === 'MANUAL_OUT' && !open)
        fail('NO_OPEN_SHIFT', 'This person has no arrival on record today.', 409);
      const event = await appendEvent(tx, {
        userId: body.userId,
        kind: body.kind,
        actorId: req.user.id,
        locationId: body.locationId,
        captureId: body.idempotencyKey,
        result: 'GREEN',
        reasons: ['BY_HAND'],
        reason: body.note ?? '',
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ATTENDANCE_MARKED',
          entityId: event.id,
          locationId: body.locationId,
          details: { userId: body.userId, kind: body.kind },
        },
      });
      return this.answer(tx, event, {});
    });
  }

  /** A mistake gets a correction beside it. The original stays, and tonight's summary names it. */
  async correct(body: z.infer<typeof attendanceCorrectionSchema>, req: AuthRequest) {
    if (body.userId === req.user.id)
      fail('OWN_RECORD', 'Someone else must correct your own hazri.', 403);
    if (body.day > istToday()) fail('BAD_DAY', 'Choose today or an earlier day.');
    return this.db.atomic(async (tx) => {
      const earlier = await tx.attendanceEvent.findUnique({
        where: { userId_captureId: { userId: body.userId, captureId: body.idempotencyKey } },
      });
      if (earlier) return this.answer(tx, earlier, { replay: true });
      const shops = await tx.staffMembership.findMany({
        where: { userId: body.userId, endedAt: null },
        select: { locationId: true },
      });
      const shop = shops.find((row) => holdsFor(req.access, 'attendance.correct', row.locationId));
      if (!shop) forbid(req, 'attendance.correct');
      const correctedAt = new Date(dayStart(body.day).getTime() + body.minute * 60000);
      if (correctedAt.getTime() > Date.now()) fail('BAD_DAY', 'Choose a time that has passed.');
      const current = await tx.attendanceDay.findUnique({
        where: { userId_day: { userId: body.userId, day: body.day } },
        select: { firstInAt: true, lastOutAt: true },
      });
      if (
        (body.corrects === 'OUT' && current?.firstInAt && correctedAt < current.firstInAt) ||
        (body.corrects === 'IN' && current?.lastOutAt && correctedAt > current.lastOutAt)
      )
        fail('TIME_ORDER', 'Going home cannot come before arriving.', 400);
      const event = await appendEvent(tx, {
        userId: body.userId,
        kind: 'CORRECTION',
        actorId: req.user.id,
        locationId: shop.locationId,
        captureId: body.idempotencyKey,
        correctsKind: body.corrects,
        correctedAt,
        reason: body.reason,
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ATTENDANCE_CORRECTED',
          entityId: event.id,
          locationId: shop.locationId,
          details: { userId: body.userId, day: body.day, corrects: body.corrects },
        },
      });
      await rebuildDay(tx, body.userId, body.day);
      return { id: event.id, ok: true };
    });
  }

  /** The proof page for one person's day: every row, and whether the chain still adds up. */
  async proof(userId: string, day: string) {
    const rows = await this.db.attendanceEvent.findMany({
      where: { stream: streamOf(userId) },
      orderBy: { seq: 'asc' },
    });
    const broken = brokenAt(rows);
    const anchor = await this.db.proofAnchor.findUnique({ where: { day } });
    return {
      userId,
      day,
      chainOk: broken === null,
      brokenAtSeq: broken,
      nightCode: anchor?.root.slice(0, 10) ?? null,
      events: await this.eventsOf(userId, day),
    };
  }

  // ---- Shop setup and the shop screen -----------------------------------------------------

  async shopSetup(id: string, body: z.infer<typeof shopSetupSchema>, req: AuthRequest) {
    const exists = await this.db.location.findUnique({ where: { id }, select: { id: true } });
    if (!exists) fail('NOT_FOUND', 'That shop could not be found.', 404);
    requireAt(req, 'screen.manage', id);
    if (((body.lat ?? null) === null) !== ((body.lng ?? null) === null))
      fail('INVALID_INPUT', 'A position needs both figures.');
    return this.db.atomic(async (tx) => {
      const shop = await tx.location.findUnique({ where: { id } });
      if (!shop) fail('NOT_FOUND', 'That shop could not be found.', 404);
      const lat = body.lat === undefined ? shop.lat : body.lat;
      if (body.attendanceOn && lat === null)
        fail('PIN_NEEDED', 'Take the shop’s position before starting hazri.', 409);
      const saved = await tx.location.update({
        where: { id },
        data: body,
        select: {
          id: true,
          name: true,
          lat: true,
          lng: true,
          radiusM: true,
          graceMinutes: true,
          attendanceOn: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'SHOP_HAZRI_CHANGED',
          entityId: id,
          locationId: id,
          details: {
            radiusM: saved.radiusM,
            graceMinutes: saved.graceMinutes,
            attendanceOn: saved.attendanceOn,
            positionChanged: body.lat !== undefined,
          },
        },
      });
      return saved;
    });
  }
  async shops(req: AuthRequest) {
    const scope = shopWhere(req, 'attendance.read');
    const rows = await this.db.location.findMany({
      where: { active: true, ...('locationId' in scope ? { id: scope.locationId } : {}) },
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        radiusM: true,
        graceMinutes: true,
        attendanceOn: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const screens = await this.db.shopScreen.findMany({
      where: { locationId: { in: rows.map((row) => row.id) }, kind: 'SCREEN', revokedAt: null },
      select: {
        id: true,
        locationId: true,
        label: true,
        status: true,
        lastSeenAt: true,
        pairingExpiresAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    // A manager's "Yahan QR dikhao" code lives until someone turns it off, so it has to be listed.
    const byHand = await this.db.shopScreen.findMany({
      where: {
        locationId: { in: rows.map((row) => row.id) },
        kind: 'MANAGER_PHONE',
        status: 'ACTIVE',
        revokedAt: null,
      },
      select: { id: true, locationId: true, label: true, status: true, lastSeenAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const holders = await this.db.user.findMany({
      where: { id: { in: byHand.map((row) => row.label.replace('manager:', '')) } },
      select: { id: true, name: true },
    });
    const holder = (label: string) =>
      holders.find((person) => person.id === label.replace('manager:', ''))?.name ?? '';
    return {
      items: rows.map((row) => ({
        ...row,
        screens: screens.filter((screen) => screen.locationId === row.id),
        handCodes: byHand
          .filter((code) => code.locationId === row.id)
          .map((code) => ({ ...code, label: holder(code.label), pairingExpiresAt: null })),
      })),
    };
  }

  private async uniqueCode(tx: Pick<Tx, 'shopScreen'>) {
    for (let tries = 0; tries < 8; tries++) {
      const code = newScreenCode();
      if (!(await tx.shopScreen.findUnique({ where: { code } }))) return code;
    }
    return fail('CONFLICT', 'Please try again.', 409);
  }
  /** The six digits are shown once, and last ten minutes. The screen never holds a person's login. */
  private pairing() {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    return {
      code,
      data: { pairingCodeHash: pairingHash(code), pairingExpiresAt: new Date(Date.now() + 600000) },
    };
  }
  async createScreen(body: z.infer<typeof screenCreateSchema>, req: AuthRequest) {
    requireAt(req, 'screen.manage', body.locationId);
    return this.db.atomic(async (tx) => {
      const pairing = this.pairing();
      const screen = await tx.shopScreen.create({
        data: {
          locationId: body.locationId,
          label: body.label ?? '',
          code: await this.uniqueCode(tx),
          pairedById: req.user.id,
          ...pairing.data,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'SHOP_SCREEN_ADDED',
          entityId: screen.id,
          locationId: body.locationId,
          details: {},
        },
      });
      return { id: screen.id, pairingCode: pairing.code, expiresAt: pairing.data.pairingExpiresAt };
    });
  }
  async revokeScreen(id: string, req: AuthRequest) {
    const screen = await this.db.shopScreen.findUnique({ where: { id } });
    if (!screen) fail('NOT_FOUND', 'That screen is not here.', 404);
    requireAt(req, 'screen.manage', screen.locationId);
    await this.db.atomic(async (tx) => {
      await tx.shopScreen.update({
        where: { id },
        data: {
          status: 'REVOKED',
          credentialHash: null,
          pairingCodeHash: null,
          revokedAt: new Date(),
          revokedById: req.user.id,
          epoch: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'SHOP_SCREEN_REVOKED',
          entityId: id,
          locationId: screen.locationId,
          details: {},
        },
      });
    });
    return { ok: true };
  }
  async pair(body: z.infer<typeof screenPairSchema>) {
    // The limit per address does nothing against many addresses, and a screen shows the shop's code.
    if ((await budgetUsed(this.db, 'screen:pair', 'store')) >= screenPairGuesses)
      fail('RESOURCE_LIMIT', 'Too many tries. Wait a while and try again.', 429);
    const token = randomBytes(32).toString('base64url');
    const paired = await this.db.atomic(async (tx) => {
      const screen = await tx.shopScreen.findFirst({
        where: {
          pairingCodeHash: pairingHash(body.code),
          pairingExpiresAt: { gt: new Date() },
          revokedAt: null,
        },
      });
      if (!screen) return null;
      await tx.shopScreen.update({
        where: { id: screen.id },
        data: {
          status: 'ACTIVE',
          credentialHash: secretHash(token),
          pairingCodeHash: null,
          pairingExpiresAt: null,
          lastSeenAt: new Date(),
        },
      });
      return { token };
    });
    if (paired) return paired;
    await this.db.atomic((tx) => budget(tx, 'screen:pair', 'store', screenPairGuesses));
    return fail('SCREEN_BAD_CODE', 'That code is wrong or has run out.', 400);
  }
  /** The wall: a code and first names with times. No "late", and nothing else, ever. */
  private async wall(screen: { id: string; code: string; epoch: number; locationId: string }) {
    const now = Date.now();
    const day = istToday(new Date(now));
    const [shop, rows] = await Promise.all([
      this.db.location.findUniqueOrThrow({
        where: { id: screen.locationId },
        select: { name: true, attendanceOn: true },
      }),
      this.db.attendanceDay.findMany({
        where: { day, locationIds: { has: screen.locationId } },
        orderBy: { firstInAt: 'asc' },
      }),
    ]);
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, name: true },
    });
    return {
      shopName: shop.name,
      attendanceOn: shop.attendanceOn,
      qr: qrText(screen, qrCounter(now)),
      msLeft: qrMsLeft(now),
      serverNow: new Date(now),
      people: rows.map((row) => ({
        name: firstName(people.find((person) => person.id === row.userId)?.name ?? ''),
        firstInAt: row.firstInAt,
        lastOutAt: row.lastOutAt,
      })),
    };
  }
  async screenToday(token: string | undefined) {
    if (!token) fail('SCREEN_REVOKED', 'Pair this screen again.', 401);
    const screen = await this.db.shopScreen.findUnique({
      where: { credentialHash: secretHash(token) },
    });
    if (!screen || screen.status !== 'ACTIVE')
      fail('SCREEN_REVOKED', 'Pair this screen again.', 401);
    if (!screen.lastSeenAt || screen.lastSeenAt.getTime() < Date.now() - 30000)
      await this.db.shopScreen.update({
        where: { id: screen.id },
        data: { lastSeenAt: new Date() },
      });
    return this.wall(screen);
  }
  /** "Yahan QR dikhao": a dead screen must not stop the shop. The record shows it came from here. */
  async showHere(locationId: string, req: AuthRequest) {
    const exists = await this.db.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!exists) fail('NOT_FOUND', 'That shop could not be found.', 404);
    requireAt(req, 'attendance.mark', locationId);
    const label = `manager:${req.user.id}`;
    const screen = await this.db.atomic(async (tx) => {
      const found = await tx.shopScreen.findFirst({
        where: { locationId, kind: 'MANAGER_PHONE', label, status: 'ACTIVE' },
      });
      if (found) return found;
      const created = await tx.shopScreen.create({
        data: {
          locationId,
          label,
          kind: 'MANAGER_PHONE',
          status: 'ACTIVE',
          code: await this.uniqueCode(tx),
          pairedById: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'SHOP_CODE_SHOWN_BY_HAND',
          entityId: created.id,
          locationId,
          details: {},
        },
      });
      return created;
    });
    return this.wall(screen);
  }

  async setSchedule(userId: string, body: z.infer<typeof staffScheduleSchema>, actorId: string) {
    // Lateness and hours already worked out stay as they were: a new shift starts today or later.
    if (body.effectiveFrom < istToday()) fail('BAD_DAY', 'A new shift starts today or later.');
    return this.db.atomic(async (tx) => {
      const before = await tx.staffSchedule.findUnique({
        where: { userId_effectiveFrom: { userId, effectiveFrom: body.effectiveFrom } },
        select: { startMinute: true, endMinute: true, breakMinutes: true, weeklyOffs: true },
      });
      const row = await tx.staffSchedule.upsert({
        where: { userId_effectiveFrom: { userId, effectiveFrom: body.effectiveFrom } },
        create: { ...body, userId, createdById: actorId },
        update: { ...body, createdById: actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'STAFF_SCHEDULE_CHANGED',
          entityId: userId,
          // Changed twice for one date, the first version would otherwise vanish.
          details: { effectiveFrom: body.effectiveFrom, ...(before ? { replaced: before } : {}) },
        },
      });
      return row;
    });
  }
  async schedule(userId: string) {
    return { schedule: await scheduleOn(this.db, userId, istToday()) };
  }
  async setNoPhone(userId: string, noPhone: boolean, actorId: string) {
    return this.db.atomic(async (tx) => {
      await tx.staffProfile.upsert({
        where: { userId },
        create: { userId, noPhone },
        update: { noPhone },
      });
      await tx.auditLog.create({
        data: { actorId, event: 'STAFF_NO_PHONE_CHANGED', entityId: userId, details: { noPhone } },
      });
      return { noPhone };
    });
  }

  // ---- The night ---------------------------------------------------------------------------

  /** Short, because if it is long nobody reads it, and the check on a manager depends on reading. */
  async summary(day: string, req: AuthRequest) {
    if (!z.iso.date().safeParse(day).success) fail('BAD_DAY', 'Choose a day.');
    const scope = shopWhere(req, 'attendance.read');
    const from = dayStart(day);
    const to = new Date(from.getTime() + 86400000);
    const shops = await this.db.location.findMany({
      where: {
        active: true,
        attendanceOn: true,
        ...('locationId' in scope ? { id: scope.locationId } : {}),
      },
      select: { id: true, name: true },
    });
    const ids = shops.map((shop) => shop.id);
    const [days, events, phones, receipts, handovers, setup, collections, byHandScreens] =
      await Promise.all([
        this.db.attendanceDay.findMany({ where: { day } }),
        this.db.attendanceEvent.findMany({
          where: {
            serverAt: { gte: from, lt: to },
            OR: [
              { kind: { in: ['MANUAL_IN', 'MANUAL_OUT', 'CORRECTION'] } },
              { kind: 'DECISION', reasons: { has: 'ACCEPTED' } },
            ],
            locationId: { in: ids },
          },
          orderBy: { serverAt: 'asc' },
        }),
        this.db.deviceLinkRequest.count({
          where: {
            createdAt: { gte: from, lt: to },
            // A manager hears about their own shops' people, not the whole firm's.
            ...('locationId' in scope
              ? {
                  userId: {
                    in: (
                      await this.db.staffMembership.findMany({
                        where: { endedAt: null, locationId: { in: ids } },
                        select: { userId: true },
                      })
                    ).map((row) => row.userId),
                  },
                }
              : {}),
          },
        }),
        this.db.stockReceipt.findMany({
          where: { createdAt: { gte: from, lt: to }, locationId: { in: ids } },
          select: {
            id: true,
            locationId: true,
            productId: true,
            quantity: true,
            supplierName: true,
            actorId: true,
          },
        }),
        this.db.cashHandover.findMany({
          where: { createdAt: { gte: from, lt: to }, locationId: { in: ids } },
        }),
        // A manager moving the shop's position or showing the code by hand can be honest, or not.
        this.db.auditLog.findMany({
          where: {
            createdAt: { gte: from, lt: to },
            event: { in: ['SHOP_HAZRI_CHANGED', 'SHOP_SCREEN_ADDED', 'SHOP_SCREEN_REVOKED'] },
            locationId: { in: ids },
          },
          select: { event: true, actorId: true, locationId: true, createdAt: true, details: true },
        }),
        this.db.driverCollection.findMany({
          where: { serverAt: { gte: from, lt: to }, locationId: { in: ids } },
          select: { driverId: true, duePaise: true, amountPaise: true, orderId: true },
        }),
        this.db.shopScreen.findMany({
          where: { kind: 'MANAGER_PHONE', locationId: { in: ids } },
          select: { id: true, label: true },
        }),
      ]);
    const handScans = await this.db.attendanceEvent.findMany({
      where: {
        serverAt: { gte: from, lt: to },
        screenId: { in: byHandScreens.map((row) => row.id) },
      },
      select: { userId: true, screenId: true },
    });
    const reviewsOpen = await this.db.attendanceReview.count({
      where: { status: 'OPEN', locationId: { in: ids } },
    });
    const anyone = [
      ...events.flatMap((row) => [row.userId, row.actorId]),
      ...receipts.map((row) => row.actorId),
      ...handovers.map((row) => row.driverId),
      ...setup.map((row) => row.actorId),
      ...collections.map((row) => row.driverId),
      ...handScans.map((row) => row.userId),
      ...byHandScreens.map((row) => row.label.replace('manager:', '')),
    ];
    const people = await this.db.user.findMany({
      where: { id: { in: [...new Set(anyone)] } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? '';
    const products = await this.db.product.findMany({
      where: { id: { in: receipts.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const anchor = await this.db.proofAnchor.findUnique({ where: { day } });
    const counted = handovers.filter((row) => row.step === 'COUNTED');
    const collected = await this.db.driverCollection.findMany({
      where: { handoverKey: { in: counted.map((row) => row.handoverKey) } },
      select: { handoverKey: true, amountPaise: true },
    });
    return {
      day,
      nightCode: anchor?.root.slice(0, 10) ?? null,
      reviewsOpen,
      phonesAsked: phones,
      shops: shops.map((shop) => {
        const here = days.filter((row) => row.locationIds.includes(shop.id));
        return {
          id: shop.id,
          name: shop.name,
          present: here.filter((row) => row.firstInAt).length,
          late: here.filter((row) => row.lateMinutes > 0).length,
          noOut: here.filter((row) => row.flags.includes('NO_OUT')).length,
        };
      }),
      byHand: events
        .filter((row) => row.kind === 'MANUAL_IN' || row.kind === 'MANUAL_OUT')
        .map((row) => ({
          name: nameOf(row.userId),
          by: nameOf(row.actorId),
          kind: row.kind,
          at: row.serverAt,
        })),
      accepted: events
        .filter((row) => row.kind === 'DECISION')
        .map((row) => ({
          name: nameOf(row.userId),
          by: nameOf(row.actorId),
          note: row.reason,
          at: row.serverAt,
        })),
      corrections: events
        .filter((row) => row.kind === 'CORRECTION')
        .map((row) => ({
          name: nameOf(row.userId),
          by: nameOf(row.actorId),
          corrects: row.correctsKind,
          to: row.correctedAt,
          reason: row.reason,
        })),
      receipts: receipts.map((row) => ({
        name: products.find((item) => item.id === row.productId)?.name ?? '',
        quantity: row.quantity,
        supplierName: row.supplierName,
        by: nameOf(row.actorId),
      })),
      setupChanges: setup.map((row) => ({
        event: row.event,
        by: nameOf(row.actorId),
        shopName: shops.find((shop) => shop.id === row.locationId)?.name ?? '',
        positionChanged: Boolean((row.details as { positionChanged?: boolean })?.positionChanged),
      })),
      scansOnManagerCode: handScans.map((row) => ({
        name: nameOf(row.userId),
        codeOf: nameOf(
          byHandScreens.find((entry) => entry.id === row.screenId)?.label.replace('manager:', '') ??
            '',
        ),
      })),
      collectionDifferences: collections
        .filter((row) => row.amountPaise !== row.duePaise)
        .map((row) => ({
          driver: nameOf(row.driverId),
          duePaise: row.duePaise,
          amountPaise: row.amountPaise,
        })),
      cashDifferences: counted
        .map((row) => {
          const offered = handovers.find(
            (entry) => entry.handoverKey === row.handoverKey && entry.step === 'OFFERED',
          );
          return {
            driver: nameOf(row.driverId),
            offeredPaise: offered?.amountPaise ?? 0,
            countedPaise: row.amountPaise,
            collectedPaise: collected
              .filter((entry) => entry.handoverKey === row.handoverKey)
              .reduce((sum, entry) => sum + entry.amountPaise, 0),
          };
        })
        .filter(
          (row) => row.offeredPaise !== row.countedPaise || row.collectedPaise !== row.countedPaise,
        ),
    };
  }

  /** At 11 PM India time. If the server was down then, the next run makes the code it missed. */
  async nightly(now = new Date()) {
    const ist = new Date(now.getTime() + 5.5 * 3600000);
    const day =
      ist.getUTCHours() >= 23 ? istToday(now) : istToday(new Date(now.getTime() - 86400000));
    const existing = await this.db.proofAnchor.findUnique({ where: { day } });
    if (existing) return;
    const heads = await this.db.$queryRaw<{ stream: string; hash: string }[]>`
      SELECT DISTINCT ON ("stream") "stream", "hash"
      FROM "AttendanceEvent" ORDER BY "stream", "seq" DESC`;
    const payHeads = await this.db.$queryRaw<{ stream: string; hash: string }[]>`
      SELECT DISTINCT ON ("stream") "stream", "hash"
      FROM "StaffLedgerEntry" ORDER BY "stream", "seq" DESC`;
    const last = await this.db.proofAnchor.findFirst({ orderBy: { day: 'desc' } });
    const prevRoot = last?.root ?? '';
    const root = rootOf([...heads, ...payHeads], prevRoot);
    await this.db.atomic(async (tx) => {
      const made = await tx.proofAnchor.createMany({
        data: [{ day, root, prevRoot, sentAt: now }],
        skipDuplicates: true,
      });
      if (!made.count) return;
      const owners = await tx.user.findMany({
        where: {
          role: 'ADMIN',
          deletedAt: null,
          staffPausedAt: null,
          staffMemberships: { some: { role: 'OWNER', endedAt: null } },
        },
        select: { id: true, language: true, phone: true, whatsappAlerts: true },
      });
      const code = root.slice(0, 10);
      const present = await tx.attendanceDay.count({ where: { day, firstInAt: { not: null } } });
      const open = await tx.attendanceReview.count({ where: { status: 'OPEN' } });
      for (const owner of owners) {
        const language = readLanguage(owner.language);
        await tx.notification.create({
          data: {
            userId: owner.id,
            dedupeKey: `night:${day}:${owner.id}`,
            title: t('owner.hazri.nightTitle', {}, language),
            body: t('owner.hazri.nightBody', { present, open, code }, language),
          },
        });
        if (owner.whatsappAlerts)
          await enqueueWhatsApp(tx, {
            userId: owner.id,
            phone: owner.phone,
            template: 'shiv_night_summary',
            params: [String(present), code],
            dedupeKey: `night-whatsapp:${day}:${owner.id}`,
          });
      }
    });
    // Tonight's code means little if the record underneath no longer adds up.
    const { broken } = await this.checkChains();
    if (broken) await this.tellOwners(`chain:${day}`, { broken });
  }
  private async tellOwners(key: string, params: { broken: number }) {
    const owners = await this.db.user.findMany({
      where: {
        role: 'ADMIN',
        deletedAt: null,
        staffPausedAt: null,
        staffMemberships: { some: { role: 'OWNER', endedAt: null } },
      },
      select: { id: true, language: true },
    });
    await this.db.notification.createMany({
      data: owners.map((owner) => ({
        userId: owner.id,
        dedupeKey: `${key}:${owner.id}`,
        title: t('owner.hazri.nightTitle', {}, readLanguage(owner.language)),
        body: t('owner.hazri.chainBroken', params, readLanguage(owner.language)),
      })),
      skipDuplicates: true,
    });
  }
  /** A dead screen during shop hours means nobody can scan, so the manager hears about it. */
  async watchScreens(now = new Date()) {
    const hour = new Date(now.getTime() + 5.5 * 3600000).getUTCHours();
    if (hour < 8 || hour >= 20) return;
    const quiet = await this.db.shopScreen.findMany({
      where: {
        kind: 'SCREEN',
        status: 'ACTIVE',
        lastSeenAt: { lt: new Date(now.getTime() - 20 * 60000) },
        location: { attendanceOn: true, active: true },
      },
      select: { locationId: true, location: { select: { name: true } } },
    });
    const stamp = `${istToday(now)}:${hour}`;
    for (const screen of quiet) {
      const people = await this.db.user.findMany({
        where: {
          role: 'ADMIN',
          deletedAt: null,
          staffPausedAt: null,
          staffMemberships: {
            some: {
              endedAt: null,
              OR: [{ role: 'OWNER' }, { role: 'MANAGER', locationId: screen.locationId }],
            },
          },
        },
        select: { id: true, language: true },
      });
      await this.db.notification.createMany({
        data: people.map((person) => ({
          userId: person.id,
          dedupeKey: `screen:${screen.locationId}:${stamp}:${person.id}`,
          title: t('owner.hazri.screenTitle', {}, readLanguage(person.language)),
          body: t(
            'owner.hazri.screenBody',
            { shop: screen.location.name },
            readLanguage(person.language),
          ),
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Housekeeping: old cards go up, old positions are erased, and every chain is checked. */
  async housekeeping(now = new Date()) {
    await this.db.attendanceReview.updateMany({
      where: {
        status: 'OPEN',
        toOwner: false,
        createdAt: { lt: new Date(now.getTime() - reviewEscalatesAfterMs) },
      },
      data: { toOwner: true },
    });
    await this.db.attendanceGeo.updateMany({
      where: { retainUntil: { lt: now }, erasedAt: null },
      data: { geoEnc: null, erasedAt: now },
    });
    await this.evidence?.sweep(now);
    await this.watchScreens(now);
  }
  async checkChains() {
    const streams = await this.db.attendanceEvent.findMany({
      distinct: ['stream'],
      select: { stream: true },
    });
    const pay = await this.db.staffLedgerEntry.findMany({
      distinct: ['stream'],
      select: { stream: true },
    });
    const broken: string[] = [];
    for (const { stream } of streams) {
      const rows = await this.db.attendanceEvent.findMany({ where: { stream } });
      if (brokenAt(rows) !== null) broken.push(stream);
    }
    for (const { stream } of pay) {
      const rows = await this.db.staffLedgerEntry.findMany({ where: { stream } });
      if (ledgerBrokenAt(rows) !== null) broken.push(stream);
    }
    return { checked: streams.length + pay.length, broken: broken.length };
  }
}

@ApiTags('Hazri')
@Controller()
export class AttendanceController {
  constructor(@Inject(Attendance) private attendance: Attendance) {}

  // Anyone may read the time: it is the one thing the phone's clock is never trusted for.
  @Public() @Get('attendance/time') time() {
    return { serverNow: new Date() };
  }
  @Can('staffapp.use', scoped)
  @Post('attendance/punch')
  @Contract(attendancePunchSchema)
  punch(
    @Input(attendancePunchSchema) body: z.infer<typeof attendancePunchSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.punch(body, req);
  }
  @Can('staffapp.use', scoped)
  @Post('attendance/problem')
  @Contract(attendanceProblemSchema)
  problem(
    @Input(attendanceProblemSchema) body: z.infer<typeof attendanceProblemSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.problem(body, req);
  }
  @Self() @Get('staff/me/today') today(@Req() req: AuthRequest) {
    return this.attendance.today(req);
  }
  @Self() @Get('staff/me/attendance') month(
    @Query('month') month: string,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.myMonth(month || istToday().slice(0, 7), req);
  }
  @Self() @Get('staff/me/attendance/:day') day(@Param('day') day: string, @Req() req: AuthRequest) {
    return this.attendance.myDay(day, req);
  }
  // A card reaches an owner's list and holds up the month's pay, so it takes someone on the staff.
  @Can('staffapp.use', scoped)
  @Post('staff/me/query')
  @Contract(attendanceQuerySchema)
  query(
    @Input(attendanceQuerySchema) body: z.infer<typeof attendanceQuerySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.query(body, req);
  }

  @Can('attendance.read', scoped) @Get('admin/attendance/shops') shops(@Req() req: AuthRequest) {
    return this.attendance.shops(req);
  }
  @Can('attendance.read', scoped) @Get('admin/attendance/day') roster(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.roster(
      shopForAction(req, 'attendance.read', query.locationId),
      query.day || istToday(),
    );
  }
  @Can('attendance.read', scoped) @Get('admin/attendance/person/:id/:day') person(
    @Param('id') id: string,
    @Param('day') day: string,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.personDay(id, day, req);
  }
  @Can('attendance.read', scoped) @Get('admin/attendance/summary') summary(
    @Query('day') day: string,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.summary(day || istToday(), req);
  }
  @Can('attendance.review', scoped) @Get('admin/attendance/reviews') reviews(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.reviews(req, query);
  }
  @Can('attendance.review', scoped)
  @Post('admin/attendance/reviews/bulk')
  @Contract(reviewBulkSchema)
  bulk(@Input(reviewBulkSchema) body: z.infer<typeof reviewBulkSchema>, @Req() req: AuthRequest) {
    return this.attendance.bulk(body, req);
  }
  @Can('attendance.review', scoped)
  @Post('admin/attendance/reviews/:id/decide')
  @Contract(reviewDecideSchema)
  decide(
    @Param('id') id: string,
    @Input(reviewDecideSchema) body: z.infer<typeof reviewDecideSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.decide(id, body, req);
  }
  @Can('attendance.mark', scoped)
  @Post('admin/attendance/manual')
  @Contract(attendanceManualSchema)
  manual(
    @Input(attendanceManualSchema) body: z.infer<typeof attendanceManualSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.manual(body, req);
  }
  @Can('attendance.correct', scoped)
  @Post('admin/attendance/corrections')
  @Contract(attendanceCorrectionSchema)
  correct(
    @Input(attendanceCorrectionSchema) body: z.infer<typeof attendanceCorrectionSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.correct(body, req);
  }
  @Can('attendance.proof.read') @Get('admin/attendance/proof/:id/:day') proof(
    @Param('id') id: string,
    @Param('day') day: string,
  ) {
    return this.attendance.proof(id, day);
  }
  @Can('attendance.proof.read') @Get('admin/attendance/chain-check') chainCheck() {
    return this.attendance.checkChains();
  }

  @Can('screen.manage', scoped)
  @Patch('admin/locations/:id/hazri')
  @Contract(shopSetupSchema)
  setup(
    @Param('id') id: string,
    @Input(shopSetupSchema) body: z.infer<typeof shopSetupSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.shopSetup(id, body, req);
  }
  @Can('screen.manage', scoped)
  @Post('admin/screens')
  @Contract(screenCreateSchema)
  createScreen(
    @Input(screenCreateSchema) body: z.infer<typeof screenCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.createScreen(body, req);
  }
  @Can('screen.manage', scoped) @Post('admin/screens/:id/revoke') revokeScreen(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.revokeScreen(id, req);
  }
  @Can('attendance.mark', scoped) @Get('admin/screens/here/:locationId') here(
    @Param('locationId') locationId: string,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.showHere(locationId, req);
  }
  // Six digits, ten minutes, and few tries: a guess has no realistic chance.
  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60000 } })
  @Post('screen/pair')
  @Contract(screenPairSchema)
  pair(@Input(screenPairSchema) body: z.infer<typeof screenPairSchema>) {
    return this.attendance.pair(body);
  }
  @Public() @Get('screen/today') screenToday(@Headers('x-shop-screen') token?: string) {
    return this.attendance.screenToday(token);
  }
  @Can('staff.manage') @Get('admin/staff/:id/schedule') schedule(@Param('id') id: string) {
    return this.attendance.schedule(id);
  }
  @Can('staff.manage')
  @Put('admin/staff/:id/schedule')
  @Contract(staffScheduleSchema)
  setSchedule(
    @Param('id') id: string,
    @Input(staffScheduleSchema) body: z.infer<typeof staffScheduleSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.setSchedule(id, body, req.user.id);
  }
  @Can('staff.manage')
  @Put('admin/staff/:id/no-phone')
  @Contract(staffNoPhoneSchema)
  setNoPhone(
    @Param('id') id: string,
    @Input(staffNoPhoneSchema) body: z.infer<typeof staffNoPhoneSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.attendance.setNoPhone(id, body.noPhone, req.user.id);
  }
}

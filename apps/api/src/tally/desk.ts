import { Controller, Get, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  istToday,
  tallyCompanyRoleSchema,
  tallyDevicePairSchema,
  tallyDeviceUpdateSchema,
  tallyLinkSchema,
  tallyMatchesSchema,
  tallyPauseSchema,
  tallyReleaseSchema,
} from '@shiv/shared';
import { t, readLanguage } from '@shiv/i18n';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { shownPhone } from '../crm/common';
import { Db } from '../db';
import {
  activeFirm,
  customerFirmWhere,
  firmAsked,
  firmsOf,
  firmWhere,
  requireCustomerVisible,
} from '../firms';
import { AuthRequest, Can, Contract, fail, Firm, forbid, Input } from '../http';
import { normalizeAlias } from '../rate-studio/rules';
import { pairingHash } from '../staff/secret';
import { copyFromFor } from './plan';
import { cleanText } from './parse';
import { TallyParts } from './parts';
import { listWindow, TallyRecon } from './recon';

const CODE_LIFE_MS = 15 * 60000;
const CHUNK_PURGE_BATCH = 200;
/** Plan 09's alert ladder starts here. Shop hours per shop are still an open question. */
const SILENT_AFTER_MS = 30 * 60000;
const shopHours = (now: Date) => {
  const hour = new Date(now.getTime() + 5.5 * 3600000).getUTCHours();
  return hour >= 8 && hour < 20;
};
const big = (value: bigint | null | undefined) =>
  value === null || value === undefined ? null : String(value);

type TieOut = { status?: string; total?: number; failed?: number; at?: string } | null;

/**
 * The Tally companies whose books this person may see: those mapped to one of their firms. A
 * company not mapped to a firm yet could hold anyone's books, so only someone who sees every firm
 * sees it.
 */
export const companyWhere = (req: Pick<AuthRequest, 'firms'>) => firmWhere(req);

/** Whether a firm-owned row is one of this person's firms. */
const inFirms = (req: Pick<AuthRequest, 'firms'>, firmId: string) => {
  const firms = firmsOf(req);
  return firms === 'ALL' || firms.includes(firmId);
};

/** Whether a Tally company is one this person may see. */
const companySeen = (req: Pick<AuthRequest, 'firms'>, firmId: string | null) => {
  const firms = firmsOf(req);
  return firms === 'ALL' || (!!firmId && firms.includes(firmId));
};

/**
 * Whether one customer's whole-customer Tally comparison stays inside this person's firms: none of
 * their khata is another firm's, and none of their linked parties is in another firm's company (or
 * one not mapped yet). Only then may someone limited to some firms see it.
 */
export async function tallyInFirms(db: Db, req: Pick<AuthRequest, 'firms'>, customerId: string) {
  const firms = firmsOf(req);
  if (firms === 'ALL') return true;
  const [elsewhere, outside] = await Promise.all([
    db.customerLedgerEntry.count({ where: { customerId, firmId: { notIn: firms } } }),
    db.tallyPartyLink.count({
      where: {
        userId: customerId,
        status: 'LINKED',
        ledger: { company: { OR: [{ firmId: null }, { firmId: { notIn: firms } }] } },
      },
    }),
  ]);
  return !elsewhere && !outside;
}

/** The desk's view of the bridge. Nothing here reaches Tally or changes a number in the books. */
@Injectable()
export class TallyDesk {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyRecon) private recon: TallyRecon,
    @Inject(TallyParts) private parts: TallyParts,
  ) {}

  // ---- PCs -------------------------------------------------------------------------------------

  async pairCode(body: z.infer<typeof tallyDevicePairSchema>, req: AuthRequest) {
    if (body.locationId) {
      const shop = await this.db.location.findUnique({
        where: { id: body.locationId },
        select: { id: true },
      });
      if (!shop) fail('INVALID_SHOP', 'Choose a shop that exists.', 400);
    }
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const expiresAt = new Date(Date.now() + CODE_LIFE_MS);
    await this.db.atomic(async (tx) => {
      await tx.tallyPairingCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await tx.tallyPairingCode.create({
        data: {
          hash: pairingHash(code),
          name: cleanText(body.name) || 'Tally PC',
          locationId: body.locationId ?? null,
          expiresAt,
          createdById: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_PAIR_CODE_MADE',
          entityId: req.user.id,
          locationId: body.locationId ?? null,
          details: {},
        },
      });
    });
    // Shown once. Only its keyed hash is kept.
    return { code, expiresAt };
  }

  async revoke(id: string, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const device = await tx.tallyDevice.findUnique({ where: { id } });
      if (!device) fail('NOT_FOUND', 'That PC is not here.', 404);
      if (device.revokedAt) return { ok: true, already: true };
      await tx.tallyDevice.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: req.user.id, state: 'REVOKED' },
      });
      await tx.tallySyncJob.updateMany({
        // Its last upload too: what a stolen PC sent just before being cut off is not read.
        where: { deviceId: id, status: { in: ['QUEUED', 'LEASED', 'UPLOADED'] } },
        data: { status: 'EXPIRED', finishedAt: new Date(), error: 'REVOKED' },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_DEVICE_REVOKED',
          entityId: id,
          locationId: device.locationId,
          details: {},
        },
      });
      return { ok: true };
    });
  }

  /** "Bridge roko": every PC stops asking Tally at its next heartbeat, within about a minute. */
  async pause(body: z.infer<typeof tallyPauseSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const moved = await tx.tallyDevice.updateMany({
        where: { revokedAt: null, ...(body.deviceId ? { id: body.deviceId } : {}) },
        data: { pausedAt: body.paused ? new Date() : null },
      });
      if (body.deviceId && !moved.count) fail('NOT_FOUND', 'That PC is not here.', 404);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: body.paused ? 'TALLY_BRIDGE_PAUSED' : 'TALLY_BRIDGE_RESUMED',
          entityId: body.deviceId ?? 'all',
          details: { devices: moved.count },
        },
      });
      return { paused: body.paused, devices: moved.count };
    });
  }

  /** A person says which file this is. Until then nothing is copied off the PC. */
  async setCompany(id: string, body: z.infer<typeof tallyCompanyRoleSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const company = await tx.tallyCompany.findUnique({ where: { id } });
      if (!company) fail('NOT_FOUND', 'That company is not here.', 404);
      if (body.ownerDeviceId) {
        const device = await tx.tallyDevice.findUnique({ where: { id: body.ownerDeviceId } });
        if (!device || device.revokedAt) fail('TALLY_COMPANY_OWNER', 'Choose a connected PC.', 400);
      }
      if (body.firmId) await activeFirm(tx, body.firmId);
      const starting = body.role === 'PRIMARY' && company.role !== 'PRIMARY';
      const today = istToday();
      const saved = await tx.tallyCompany.update({
        where: { id },
        data: {
          ...(body.role ? { role: body.role } : {}),
          ...(body.firmId !== undefined ? { firmId: body.firmId } : {}),
          ...(body.ownerDeviceId ? { ownerDeviceId: body.ownerDeviceId } : {}),
          // Whether this file counts, or which firm it is, changes who owes what, so the Farq list is
          // worked out again.
          ...((body.role && body.role !== company.role) ||
          (body.firmId !== undefined && body.firmId !== company.firmId)
            ? { reconDue: true }
            : {}),
          ...(starting
            ? { copyFrom: company.copyFrom ?? copyFromFor(company, today), failures: 0 }
            : {}),
        },
        select: { id: true, role: true, ownerDeviceId: true, firmId: true, copyFrom: true },
      });
      // One firm keeps one set of books. Asked after the change, so moving either the role or the
      // firm onto a taken pair is refused alike.
      if (saved.role === 'PRIMARY' && saved.firmId) {
        const taken = await tx.tallyCompany.count({
          where: { id: { not: id }, role: 'PRIMARY', firmId: saved.firmId },
        });
        if (taken)
          fail(
            'FIRM_REQUIRED',
            'Another Tally company already keeps this firm’s books. Choose a different firm.',
            409,
          );
      }
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_COMPANY_SET',
          entityId: id,
          details: {
            role: saved.role,
            ownerDeviceId: saved.ownerDeviceId,
            firmId: saved.firmId,
            wasFirmId: company.firmId,
          },
        },
      });
      return saved;
    });
  }

  async publishRelease(body: z.infer<typeof tallyReleaseSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      if (await tx.tallyRelease.findUnique({ where: { version: body.version } }))
        fail('TALLY_RELEASE_EXISTS', 'That version is already here. Use a new number.', 409);
      await tx.tallyRelease.create({
        data: {
          version: body.version,
          manifest: body.manifest,
          signature: body.signature,
          files: body.files,
          createdById: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_RELEASE_ADDED',
          entityId: body.version,
          details: { files: Object.keys(body.files).length },
        },
      });
      return { version: body.version };
    });
  }

  async chooseRelease(id: string, version: string | null, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const device = await tx.tallyDevice.findUnique({ where: { id } });
      if (!device) fail('NOT_FOUND', 'That PC is not here.', 404);
      if (version && !(await tx.tallyRelease.findUnique({ where: { version } })))
        fail('BRIDGE_NO_RELEASE', 'That release is not here.', 404);
      await tx.tallyDevice.update({ where: { id }, data: { targetVersion: version } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_RELEASE_CHOSEN',
          entityId: id,
          details: { version },
        },
      });
      return { deviceId: id, targetVersion: version };
    });
  }

  // ---- Status ----------------------------------------------------------------------------------

  /** States and times only: no party, no amount. The technical operator reads this too. */
  async status(now = new Date()) {
    const [devices, companies, voucherCounts] = await Promise.all([
      this.db.tallyDevice.findMany({ orderBy: { createdAt: 'asc' } }),
      this.db.tallyCompany.findMany({ orderBy: { createdAt: 'asc' } }),
      this.db.tallyVoucher.groupBy({
        by: ['companyId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const today = istToday(now);
    return {
      serverNow: now,
      connected: devices.some((device) => !device.revokedAt && device.lastHeartbeatAt),
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        locationId: device.locationId,
        state: this.deviceState(device, now),
        stateSince: device.stateSince,
        lastHeartbeatAt: device.lastHeartbeatAt,
        lastGoodAt: device.lastGoodAt,
        lastWakeAt: device.lastWakeAt,
        version: device.version,
        targetVersion: device.targetVersion,
        os: device.os,
        paused: Boolean(device.pausedAt),
        revoked: Boolean(device.revokedAt),
        caps: device.caps,
      })),
      companies: companies.map((company) => {
        const tieOut = company.tieOut as TieOut;
        const copyFrom = company.copyFrom ?? today;
        const totalDays = Math.max(
          1,
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${copyFrom}T00:00:00Z`)) / 86400000 + 1,
        );
        const cursor = company.backfillCursor ?? today;
        const doneDays = Math.max(
          0,
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cursor}T00:00:00Z`)) / 86400000,
        );
        return {
          id: company.id,
          name: company.name,
          role: company.role,
          ownerDeviceId: company.ownerDeviceId,
          firmId: company.firmId,
          booksFrom: company.booksFrom,
          lastVoucherDate: company.lastVoucherDate,
          copyFrom: company.copyFrom,
          phase: company.phase,
          copiedPercent:
            company.phase === 'BACKFILL'
              ? Math.min(99, Math.floor((doneDays / totalDays) * 100))
              : company.phase === 'LIVE'
                ? 100
                : 0,
          copiedBackTo: company.backfillCursor,
          freshAt: company.freshAt,
          vouchers: voucherCounts.find((row) => row.companyId === company.id)?._count._all ?? 0,
          tieOut: tieOut ?? { status: 'PENDING' },
          failures: company.failures,
          lastError: company.lastError,
          rewrittenAt: company.rewrittenAt,
          sameNameAsId: company.sameNameAsId,
        };
      }),
    };
  }

  private deviceState(
    device: {
      revokedAt: Date | null;
      state: string;
      lastHeartbeatAt: Date | null;
      pausedAt: Date | null;
    },
    now: Date,
  ) {
    if (device.revokedAt) return 'REVOKED';
    if (device.pausedAt) return 'PAUSED';
    if (
      device.lastHeartbeatAt &&
      now.getTime() - device.lastHeartbeatAt.getTime() > SILENT_AFTER_MS
    )
      return shopHours(now) ? 'PC_SILENT' : 'PC_ASLEEP';
    return device.state;
  }

  async health(now = new Date()) {
    const base = await this.status(now);
    const jobs = await this.db.tallySyncJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        deviceId: true,
        companyId: true,
        kind: true,
        status: true,
        error: true,
        createdAt: true,
        uploadedAt: true,
        finishedAt: true,
        result: true,
      },
    });
    const parts = await this.db.tallyChunk.aggregate({
      _count: { _all: true },
      _sum: { size: true },
    });
    return {
      ...base,
      jobs,
      storedParts: parts._count._all,
      storedBytes: parts._sum.size ?? 0,
    };
  }

  // ---- Parties (T3) ----------------------------------------------------------------------------

  /** Biggest balance first, with progress in money. Suggestions only: linking is always a person. */
  async parties(query: Record<string, unknown>, req: AuthRequest) {
    const { take, skip } = listWindow(query);
    const companies = await this.db.tallyCompany.findMany({
      where: { role: 'PRIMARY', ...companyWhere(req) },
      select: { id: true, name: true, freshAt: true },
    });
    const companyIds = companies
      .map((row) => row.id)
      .filter((id) => typeof query.companyId !== 'string' || id === query.companyId);
    const className = query.class === 'CREDITOR' ? 'CREDITOR' : 'DEBTOR';
    const filter = typeof query.filter === 'string' ? query.filter : 'all';
    const words = typeof query.q === 'string' ? query.q.slice(0, 80) : '';
    const rows = await this.db.$queryRaw<
      {
        id: string;
        companyId: string;
        guid: string;
        name: string;
        parent: string;
        phones: string[];
        gstin: string | null;
        closingPaise: bigint | null;
        closingAsOf: Date | null;
        tieOutOk: boolean | null;
        status: string | null;
        userId: string | null;
        method: string | null;
        confirmedById: string | null;
        confirmedAt: Date | null;
      }[]
    >`
      SELECT l.id, l."companyId", l.guid, l.name, l.parent, l.phones, l.gstin, l."closingPaise",
        l."closingAsOf", l."tieOutOk", k.status, k."userId", k.method, k."confirmedById", k."confirmedAt"
      FROM "TallyLedger" l
      LEFT JOIN "TallyPartyLink" k ON k."companyId" = l."companyId" AND k.guid = l.guid
      WHERE l."deletedAt" IS NULL AND l.class = ${className}
        AND l."companyId" = ANY(${companyIds}::text[])
        AND (${words} = '' OR l.name ILIKE ${`%${words}%`})
        AND (${filter} = 'all'
          OR (${filter} = 'linked' AND k.status = 'LINKED')
          OR (${filter} = 'notCustomer' AND k.status = 'NOT_CUSTOMER')
          OR (${filter} = 'unlinked' AND (k.status IS NULL OR k.status = 'UNLINKED')))
      ORDER BY ABS(COALESCE(l."closingPaise", 0)) DESC, l.id
      LIMIT ${take + 1} OFFSET ${skip}`;
    const totals = await this.db.$queryRaw<
      { total: string; linked: string; parties: number; linkedParties: number }[]
    >`
      SELECT COALESCE(SUM(ABS(l."closingPaise")), 0)::text AS total,
        COALESCE(SUM(ABS(l."closingPaise")) FILTER (WHERE k.status = 'LINKED'), 0)::text AS linked,
        COUNT(*)::int AS parties,
        (COUNT(*) FILTER (WHERE k.status = 'LINKED'))::int AS "linkedParties"
      FROM "TallyLedger" l
      LEFT JOIN "TallyPartyLink" k ON k."companyId" = l."companyId" AND k.guid = l.guid
      WHERE l."deletedAt" IS NULL AND l.class = ${className} AND l."companyId" = ANY(${companyIds}::text[])`;
    const page = rows.slice(0, take);
    // A party linked to a customer their firms never dealt with shows as linked, to nobody.
    const people = await this.db.user.findMany({
      where: {
        id: { in: page.map((row) => row.userId).filter((id): id is string => Boolean(id)) },
        ...customerFirmWhere(req),
      },
      select: { id: true, name: true, phone: true },
    });
    const items = [];
    for (const row of page) {
      const linkedTo = people.find((person) => person.id === row.userId) ?? null;
      items.push({
        id: row.id,
        companyId: row.companyId,
        company: companies.find((company) => company.id === row.companyId)?.name ?? '',
        name: row.name,
        group: row.parent,
        phones: row.phones,
        gstin: row.gstin,
        closingPaise: big(row.closingPaise),
        asOf: companies.find((company) => company.id === row.companyId)?.freshAt ?? row.closingAsOf,
        tieOutOk: row.tieOutOk,
        status: row.status ?? 'UNLINKED',
        method: row.method,
        confirmedById: row.confirmedById,
        confirmedAt: row.confirmedAt,
        // The accountant reads lists with no customer's number on them. The ledger's own phones are
        // Tally's, which the accountant keeps.
        customer: linkedTo && { ...linkedTo, phone: shownPhone(req, linkedTo.phone) },
        suggestions:
          linkedTo || row.status === 'NOT_CUSTOMER'
            ? []
            : (await this.suggest(row, req)).map((person) => ({
                ...person,
                phone: shownPhone(req, person.phone),
              })),
      });
    }
    const first = totals[0]!;
    return {
      items,
      nextSkip: rows.length > take ? skip + take : null,
      progress: {
        linkedPaise: first.linked,
        totalPaise: first.total,
        linkedParties: first.linkedParties,
        totalParties: first.parties,
      },
    };
  }

  private async suggest(
    ledger: { name: string; phones: string[]; gstin: string | null },
    req: Pick<AuthRequest, 'firms'>,
  ) {
    const found = new Map<
      string,
      { userId: string; name: string; phone: string; area: string; by: string; score: number }
    >();
    const customers = { deletedAt: null, role: { not: 'ADMIN' as const } };
    if (ledger.phones.length) {
      const byPhone = await this.db.user.findMany({
        where: { ...customers, phone: { in: ledger.phones } },
        select: { id: true, name: true, phone: true, area: true },
        take: 3,
      });
      for (const person of byPhone)
        found.set(person.id, {
          userId: person.id,
          name: person.name,
          phone: person.phone,
          area: person.area ?? '',
          by: 'PHONE',
          score: 100,
        });
    }
    if (ledger.gstin) {
      const quotes = await this.db.quote.findMany({
        where: { gstin: ledger.gstin },
        select: {
          user: {
            select: { id: true, name: true, phone: true, area: true, deletedAt: true, role: true },
          },
        },
        take: 3,
      });
      for (const { user } of quotes)
        if (
          user &&
          !user.deletedAt &&
          user.role !== 'ADMIN' &&
          user.phone !== 'walk-in:store' &&
          !found.has(user.id)
        )
          found.set(user.id, {
            userId: user.id,
            name: user.name,
            phone: user.phone,
            area: user.area ?? '',
            by: 'GSTIN',
            score: 95,
          });
    }
    const wanted = normalizeAlias(ledger.name);
    if (wanted) {
      const byName = await this.db.$queryRaw<
        { id: string; name: string; phone: string; area: string | null; score: number }[]
      >`
        SELECT id, name, phone, area, similarity(lower(name), ${wanted})::float AS score
        FROM "User"
        WHERE role <> 'ADMIN' AND "deletedAt" IS NULL AND phone <> 'walk-in:store'
          AND similarity(lower(name), ${wanted}) > 0.2
        ORDER BY score DESC, id LIMIT 3`;
      for (const person of byName)
        if (!found.has(person.id))
          found.set(person.id, {
            userId: person.id,
            name: person.name,
            phone: person.phone,
            area: person.area ?? '',
            by: 'NAME',
            score: Math.round(person.score * 100),
          });
    }
    // Another firm's customers are not offered: the person could not see whom they were linking.
    if (firmsOf(req) !== 'ALL' && found.size) {
      const seen = await this.db.user.findMany({
        where: { id: { in: [...found.keys()] }, ...customerFirmWhere(req) },
        select: { id: true },
      });
      for (const id of found.keys()) if (!seen.some((row) => row.id === id)) found.delete(id);
    }
    return [...found.values()].slice(0, 3);
  }

  /** A party in a company this person may see, or not found, as if it were not there. */
  private async ledgerSeen(tx: Pick<Db, 'tallyLedger'>, ledgerId: string, req: AuthRequest) {
    const ledger = await tx.tallyLedger.findUnique({
      where: { id: ledgerId },
      include: { company: { select: { firmId: true } } },
    });
    if (!ledger || !companySeen(req, ledger.company.firmId))
      fail('NOT_FOUND', 'That party is not here.', 404);
    return ledger;
  }

  async link(ledgerId: string, body: z.infer<typeof tallyLinkSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const ledger = await this.ledgerSeen(tx, ledgerId, req);
      if (ledger.deletedAt) fail('TALLY_LEDGER_GONE', 'This party is no longer in Tally.', 409);
      let userId = body.userId;
      if (body.phone) {
        // As a phone order does: the number makes or finds the account.
        const person = await tx.user.upsert({
          where: { phone: body.phone },
          // The name a person typed. What the books call them is the accountant's, not the customer's.
          create: { phone: body.phone, name: cleanText(body.name ?? '').slice(0, 120) },
          update: {},
          select: { id: true },
        });
        userId = person.id;
      }
      const person = await tx.user.findUnique({
        where: { id: userId! },
        select: { id: true, role: true, deletedAt: true, phone: true },
      });
      if (
        !person ||
        person.deletedAt ||
        person.role === 'ADMIN' ||
        person.phone === 'walk-in:store'
      )
        fail('TALLY_NOT_CUSTOMER', 'Only a customer’s account can be linked.', 400);
      // Not another firm's customer, found by id or by a number typed in. Refused in the same words
      // as an id that is no customer at all, so the answer says nothing about the other firm.
      if (
        firmsOf(req) !== 'ALL' &&
        !(await tx.user.count({ where: { id: person.id, ...customerFirmWhere(req) } }))
      )
        fail('TALLY_NOT_CUSTOMER', 'Only a customer’s account can be linked.', 400);
      const held = await tx.tallyPartyLink.findUnique({
        where: { companyId_guid: { companyId: ledger.companyId, guid: ledger.guid } },
      });
      if (held?.status === 'LINKED' && held.userId === person.id)
        return { id: held.id, status: 'LINKED', userId: person.id, repeat: true };
      // One ledger belongs to one account. Undo the wrong link first, so the log tells the story.
      if (held?.status === 'LINKED')
        fail('TALLY_LINK_TAKEN', 'This party is already linked to someone else.', 409);
      const data = {
        userId: person.id,
        status: 'LINKED',
        method: body.method,
        score: body.score ?? null,
        confirmedById: req.user.id,
        confirmedAt: new Date(),
      };
      const saved = await tx.tallyPartyLink.upsert({
        where: { companyId_guid: { companyId: ledger.companyId, guid: ledger.guid } },
        create: { companyId: ledger.companyId, guid: ledger.guid, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_PARTY_LINKED',
          entityId: ledger.id,
          details: {
            companyId: ledger.companyId,
            guid: ledger.guid,
            userId: person.id,
            method: body.method,
          },
        },
      });
      await tx.tallyCompany.update({ where: { id: ledger.companyId }, data: { reconDue: true } });
      return { id: saved.id, status: 'LINKED', userId: person.id };
    });
  }

  async unlink(ledgerId: string, req: AuthRequest) {
    const result = await this.db.atomic(async (tx) => {
      const ledger = await this.ledgerSeen(tx, ledgerId, req);
      const held = await tx.tallyPartyLink.findUnique({
        where: { companyId_guid: { companyId: ledger.companyId, guid: ledger.guid } },
      });
      if (!held || held.status === 'UNLINKED')
        return { status: 'UNLINKED', wasUserId: null, repeat: true };
      await tx.tallyPartyLink.update({
        where: { id: held.id },
        data: {
          userId: null,
          status: 'UNLINKED',
          confirmedById: req.user.id,
          confirmedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_PARTY_UNLINKED',
          entityId: ledger.id,
          details: {
            companyId: ledger.companyId,
            guid: ledger.guid,
            wasUserId: held.userId,
            wasStatus: held.status,
          },
        },
      });
      return { status: 'UNLINKED', wasUserId: held.userId };
    });
    // Their line on the Farq list goes now, not when the mirror next moves.
    if (result.wasUserId) await this.recon.refresh(result.wasUserId);
    return { status: result.status, ...('repeat' in result ? { repeat: true } : {}) };
  }

  /** "Grahak nahi": Cash Sales and the like. Stays in Tally lists, off the to-do list. */
  async notCustomer(ledgerId: string, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const ledger = await this.ledgerSeen(tx, ledgerId, req);
      const held = await tx.tallyPartyLink.findUnique({
        where: { companyId_guid: { companyId: ledger.companyId, guid: ledger.guid } },
      });
      if (held?.status === 'LINKED')
        fail('TALLY_LINK_TAKEN', 'Undo the link to this customer first.', 409);
      const data = {
        userId: null,
        status: 'NOT_CUSTOMER',
        method: 'TYPED',
        confirmedById: req.user.id,
        confirmedAt: new Date(),
      };
      await tx.tallyPartyLink.upsert({
        where: { companyId_guid: { companyId: ledger.companyId, guid: ledger.guid } },
        create: { companyId: ledger.companyId, guid: ledger.guid, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_PARTY_NOT_CUSTOMER',
          entityId: ledger.id,
          details: { companyId: ledger.companyId, guid: ledger.guid },
        },
      });
      return { status: 'NOT_CUSTOMER' };
    });
  }

  // ---- Matches (T4) ----------------------------------------------------------------------------

  /** A person says this khata entry is this voucher. Both books stay as they were. */
  async match(body: z.infer<typeof tallyMatchesSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const made: string[] = [];
      for (const item of body.items) {
        const entry = await tx.customerLedgerEntry.findUnique({ where: { id: item.entryId } });
        const voucher = await tx.tallyVoucher.findUnique({
          where: { id: item.voucherId },
          select: {
            id: true,
            companyId: true,
            partyGuid: true,
            partyAmountPaise: true,
            deletedAt: true,
            company: { select: { firmId: true } },
          },
        });
        // Another firm's entry or books answer as not found, the same as a wrong id.
        if (
          !entry ||
          !voucher ||
          voucher.deletedAt ||
          !voucher.partyGuid ||
          !inFirms(req, entry.firmId) ||
          !companySeen(req, voucher.company.firmId)
        )
          fail('TALLY_MATCH_BAD', 'That entry or voucher could not be found.', 400);
        const link = await tx.tallyPartyLink.findUnique({
          where: { companyId_guid: { companyId: voucher.companyId, guid: voucher.partyGuid } },
        });
        // Someone else's voucher cannot explain this customer's khata.
        if (link?.status !== 'LINKED' || link.userId !== entry.customerId)
          fail('TALLY_MATCH_BAD', 'That voucher is not on this customer’s Tally party.', 400);
        const earlier = await tx.khataVoucherMatch.findMany({
          where: { entryId: entry.id },
          orderBy: { createdAt: 'asc' },
        });
        const undone = new Set(earlier.map((row) => row.undoesId).filter(Boolean));
        const open = earlier.find((row) => !row.undoesId && !undone.has(row.id));
        if (open?.voucherId === voucher.id) {
          made.push(open.id);
          continue;
        }
        if (open) fail('TALLY_MATCH_BAD', 'This entry is already matched. Undo that first.', 409);
        const row = await tx.khataVoucherMatch.create({
          data: {
            entryId: entry.id,
            voucherId: voucher.id,
            amountPaise: BigInt(entry.amountPaise),
            method: 'PERSON',
            confirmedById: req.user.id,
          },
        });
        made.push(row.id);
        await tx.tallyCompany.update({
          where: { id: voucher.companyId },
          data: { reconDue: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'TALLY_MATCH_MADE',
            entityId: row.id,
            details: { entryId: entry.id, voucherId: voucher.id },
          },
        });
      }
      return { ids: made };
    });
  }

  async undoMatch(id: string, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const row = await tx.khataVoucherMatch.findUnique({ where: { id } });
      if (!row || row.undoesId) fail('NOT_FOUND', 'That match is not here.', 404);
      if (firmsOf(req) !== 'ALL') {
        const [entry, books] = await Promise.all([
          tx.customerLedgerEntry.findUnique({
            where: { id: row.entryId },
            select: { firmId: true },
          }),
          tx.tallyVoucher.findUnique({
            where: { id: row.voucherId },
            select: { company: { select: { firmId: true } } },
          }),
        ]);
        if (
          !entry ||
          !inFirms(req, entry.firmId) ||
          !companySeen(req, books?.company.firmId ?? null)
        )
          fail('NOT_FOUND', 'That match is not here.', 404);
      }
      const already = await tx.khataVoucherMatch.findUnique({ where: { undoesId: id } });
      if (already) return { id: already.id, repeat: true };
      const undo = await tx.khataVoucherMatch.create({
        data: {
          entryId: row.entryId,
          voucherId: row.voucherId,
          amountPaise: row.amountPaise,
          method: 'PERSON',
          confirmedById: req.user.id,
          undoesId: id,
        },
      });
      const voucher = await tx.tallyVoucher.findUnique({
        where: { id: row.voucherId },
        select: { companyId: true },
      });
      if (voucher)
        await tx.tallyCompany.update({
          where: { id: voucher.companyId },
          data: { reconDue: true },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TALLY_MATCH_UNDONE',
          entityId: id,
          details: { entryId: row.entryId, voucherId: row.voucherId },
        },
      });
      return { id: undo.id };
    });
  }

  // ---- The worker ------------------------------------------------------------------------------

  private async recipients() {
    return this.db.user.findMany({
      where: {
        role: 'ADMIN',
        deletedAt: null,
        staffPausedAt: null,
        staffMemberships: { some: { role: 'TECH_OPERATOR', endedAt: null } },
      },
      select: { id: true, language: true },
    });
  }

  /**
   * Plan 09's alert ladder, first rung. Until shop hours are set only the technical operator hears,
   * and at most one line per PC, per state, per day. Words only: no party, amount or code goes out.
   */
  async watch(now = new Date()) {
    const devices = await this.db.tallyDevice.findMany({ where: { revokedAt: null } });
    const companies = await this.db.tallyCompany.findMany({ where: { role: 'PRIMARY' } });
    const inHours = shopHours(now);
    const alerts: { key: string; word: string; params: Record<string, string | number> }[] = [];
    const clock = (at: Date | null) =>
      at
        ? new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          }).format(at)
        : '-';
    for (const device of devices) {
      const params = { pc: device.name, at: clock(device.lastGoodAt) };
      const caps = (device.caps ?? {}) as {
        diskFreeMb?: number;
        updateFailed?: string;
        releaseChangedOn?: string;
        claimedElsewhere?: number;
      };
      const silent =
        !device.pausedAt &&
        device.lastHeartbeatAt &&
        now.getTime() - device.lastHeartbeatAt.getTime() > SILENT_AFTER_MS;
      if (silent && inHours) {
        await this.db.tallyDevice.updateMany({
          where: { id: device.id, state: { not: 'PC_SILENT' } },
          data: { state: 'PC_SILENT', stateSince: now },
        });
        alerts.push({ key: `${device.id}:PC_SILENT`, word: 'owner.tally.silent', params });
      } else if (!silent && inHours && !device.pausedAt) {
        const long = now.getTime() - device.stateSince.getTime() > SILENT_AFTER_MS;
        if (
          long &&
          ['TALLY_CLOSED', 'PORT_OFF', 'NO_COMPANY', 'COMPANY_MISSING', 'BAD_ANSWER'].includes(
            device.state,
          )
        )
          alerts.push({
            key: `${device.id}:${device.state}`,
            word: 'owner.tally.closed',
            params,
          });
      }
      // These do not wait for shop hours.
      if (device.state === 'EDUCATIONAL')
        alerts.push({ key: `${device.id}:EDUCATIONAL`, word: 'owner.tally.educational', params });
      if (caps.updateFailed)
        alerts.push({
          key: `${device.id}:UPDATE_FAILED`,
          word: 'owner.tally.updateFailed',
          params,
        });
      if (caps.diskFreeMb !== undefined && caps.diskFreeMb < 1024)
        alerts.push({ key: `${device.id}:DISK_LOW`, word: 'owner.tally.diskLow', params });
      if (caps.releaseChangedOn === istToday(now))
        alerts.push({ key: `${device.id}:RELEASE`, word: 'owner.tally.release', params });
      if (caps.claimedElsewhere)
        alerts.push({ key: `${device.id}:CLAIMED`, word: 'owner.tally.claimed', params });
    }
    for (const company of companies) {
      const tieOut = company.tieOut as TieOut;
      const params = { company: company.name, at: clock(company.freshAt) };
      if (tieOut?.status === 'FAILED')
        alerts.push({
          key: `${company.id}:TIE_OUT_FAILED`,
          word: 'owner.tally.tieOut',
          params: { ...params, failed: tieOut.failed ?? 0 },
        });
      if (company.rewrittenAt)
        alerts.push({ key: `${company.id}:REWRITTEN`, word: 'owner.tally.rewritten', params });
      if (company.failures >= 3)
        alerts.push({ key: `${company.id}:SYNC_FAILED`, word: 'owner.tally.syncFailed', params });
    }
    if (!alerts.length) return 0;
    const people = await this.recipients();
    const day = istToday(now);
    const rows = alerts.flatMap((alert) =>
      people.map((person) => {
        const language = readLanguage(person.language);
        return {
          userId: person.id,
          dedupeKey: `tally:${alert.key}:${day}:${person.id}`,
          title: t('owner.tally.title', {}, language),
          body: t(alert.word as never, alert.params as never, language),
        };
      }),
    );
    if (rows.length) await this.db.notification.createMany({ data: rows, skipDuplicates: true });
    return rows.length;
  }

  /** Raw parts go after 7 days, or 30 if parsing failed. The rows they became stay. */
  async purge(now = new Date()) {
    const due = await this.db.tallyChunk.findMany({
      where: { expiresAt: { lt: now } },
      take: CHUNK_PURGE_BATCH,
    });
    for (const chunk of due) {
      await this.parts.remove(chunk.storageKey);
      await this.db.tallyChunk.delete({
        where: { jobId_seq: { jobId: chunk.jobId, seq: chunk.seq } },
      });
    }
    await this.db.tallyPairingCode.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } },
    });
    return due.length;
  }
}

@ApiTags('Tally')
@Controller('admin/tally')
export class TallyDeskController {
  constructor(
    @Inject(TallyDesk) private desk: TallyDesk,
    @Inject(TallyRecon) private recon: TallyRecon,
    @Inject(Db) private db: Db,
  ) {}

  @Can('tally.read') @Get('status') status() {
    return this.desk.status();
  }
  @Can('tally.health') @Get('health') health() {
    return this.desk.health();
  }
  @Can('tally.devices')
  @Post('devices/pair')
  @Contract(tallyDevicePairSchema)
  pairCode(
    @Input(tallyDevicePairSchema) body: z.infer<typeof tallyDevicePairSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.pairCode(body, req);
  }
  @Can('tally.devices') @Post('devices/:id/revoke') revoke(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.desk.revoke(id, req);
  }
  @Can('tally.devices')
  @Post('devices/:id/release')
  @Contract(tallyDeviceUpdateSchema)
  chooseRelease(
    @Param('id') id: string,
    @Input(tallyDeviceUpdateSchema) body: z.infer<typeof tallyDeviceUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.chooseRelease(id, body.version, req);
  }
  @Can('tally.devices')
  @Post('pause')
  @Contract(tallyPauseSchema)
  pause(@Input(tallyPauseSchema) body: z.infer<typeof tallyPauseSchema>, @Req() req: AuthRequest) {
    return this.desk.pause(body, req);
  }
  @Can('tally.devices')
  @Post('companies/:id')
  @Contract(tallyCompanyRoleSchema)
  setCompany(
    @Param('id') id: string,
    @Input(tallyCompanyRoleSchema) body: z.infer<typeof tallyCompanyRoleSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.setCompany(id, body, req);
  }
  @Can('tally.devices')
  @Post('releases')
  @Contract(tallyReleaseSchema)
  publishRelease(
    @Input(tallyReleaseSchema) body: z.infer<typeof tallyReleaseSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.publishRelease(body, req);
  }
  @Firm('own')
  @Can('tally.numbers.view')
  @Get('parties')
  parties(@Query() query: Record<string, string>, @Req() req: AuthRequest) {
    return this.desk.parties(query, req);
  }
  @Firm('own')
  @Can('tally.match')
  @Post('parties/:id/link')
  @Contract(tallyLinkSchema)
  link(
    @Param('id') id: string,
    @Input(tallyLinkSchema) body: z.infer<typeof tallyLinkSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.link(id, body, req);
  }
  @Firm('own')
  @Can('tally.match')
  @Post('parties/:id/unlink')
  unlink(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.desk.unlink(id, req);
  }
  @Firm('own')
  @Can('tally.match')
  @Post('parties/:id/not-customer')
  notCustomer(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.desk.notCustomer(id, req);
  }
  /**
   * One customer's two numbers. An owner gets the whole customer, or one firm's part if asked.
   * Someone limited to one firm gets that firm's khata against that firm's books. Limited to several,
   * the whole customer only when none of it is another firm's.
   */
  @Firm('own')
  @Can('tally.numbers.view')
  @Get('customers/:id/numbers')
  async numbers(@Param('id') id: string, @Query('firmId') asked: unknown, @Req() req: AuthRequest) {
    await requireCustomerVisible(this.db, req, id);
    const firm = firmAsked(req, asked);
    const firms = firmsOf(req);
    if ('firmId' in firm && typeof firm.firmId === 'string')
      return this.recon.numbers(id, new Date(), { firmId: firm.firmId });
    if (firms === 'ALL') return this.recon.numbers(id);
    if (firms.length === 1) return this.recon.numbers(id, new Date(), { firmId: firms[0]! });
    if (!(await tallyInFirms(this.db, req, id))) forbid(req, 'tally.numbers.view');
    return this.recon.numbers(id);
  }
  @Firm('own')
  @Can('tally.numbers.view')
  @Get('differences')
  async differences(@Query() query: Record<string, string>, @Req() req: AuthRequest) {
    const firms = firmsOf(req);
    const list = await this.recon.differences(query, firms === 'ALL' ? undefined : firms);
    return {
      ...list,
      items: list.items.map((row) => ({ ...row, phone: shownPhone(req, row.phone) })),
    };
  }
  @Firm('own')
  @Can('tally.match')
  @Post('matches')
  @Contract(tallyMatchesSchema)
  match(
    @Input(tallyMatchesSchema) body: z.infer<typeof tallyMatchesSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.desk.match(body, req);
  }
  @Firm('own')
  @Can('tally.match')
  @Post('matches/:id/undo')
  undoMatch(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.desk.undoMatch(id, req);
  }
}

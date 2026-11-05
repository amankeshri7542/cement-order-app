import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Prisma, TallyCompany, TallyDevice } from '@prisma/client';
import {
  bridgeFinishSchema,
  bridgeHeartbeatSchema,
  bridgePairMessage,
  bridgePairSchema,
  istToday,
  tallyReadNames,
  type TallyReadName,
} from '@shiv/shared';
import { createPublicKey } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { budget, clientIp } from '../abuse';
import { Db } from '../db';
import { Contract, fail, hash, Input, Public } from '../http';
import { pairingHash } from '../staff/secret';
import { BridgeGuard, ed25519Verify, type BridgeRequest } from './auth';
import { cleanText, readCompanyList, readSmall, TallyAnswerError, type Row } from './parse';
import { TallyParts } from './parts';
import { copyFromFor, planJob, type ReadSpec } from './plan';

type Tx = Prisma.TransactionClient;
const JSON_BODY_LIMIT = 512 * 1024;
const PART_LIMIT = 5 * 1024 * 1024;
const LEASE_MS = 30 * 60000;
/** A job left unfinished this long is given up on, so the PC gets a fresh one. */
const JOB_GIVE_UP_MS = 6 * 3600000;
const CHUNK_KEPT_MS = 7 * 86400000;
/** A stolen PC cannot fill the bucket. Far above what a shop's Tally can produce in a day. */
const DAILY_UPLOAD_KB = 2 * 1024 * 1024;
const config = { heartbeatSec: 60, probeSec: 120, dailyCapMb: 200 };

const bigOf = (text: string | undefined) =>
  /^\d{1,18}$/.test(text ?? '') ? BigInt(text!) : BigInt(0);
const dayOrNull = (text: string | undefined) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text ?? '') ? text! : null;

/** Bodies are raw bytes here, as the signature covers them. JSON is read only after that passes. */
function jsonBody<T>(req: BridgeRequest, schema: z.ZodType<T>): T {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.length > JSON_BODY_LIMIT) fail('UPLOAD_TOO_LARGE', 'This request is too large.', 413);
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    fail('BRIDGE_BAD_BODY', 'This request could not be read.', 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail('INVALID_INPUT', 'This request could not be read.', 400);
  return parsed.data;
}

type Probe = {
  companies: Row[] | null;
  licence: Row | null;
  listed: string[];
  problem: string | null;
};
async function readProbe(probe: z.infer<typeof bridgeHeartbeatSchema>['probe']): Promise<Probe> {
  const empty: Probe = { companies: null, licence: null, listed: [], problem: null };
  if (!probe) return empty;
  try {
    const companies = await readSmall('companies', probe.companies);
    const licence = probe.licence ? await readSmall('licence', probe.licence) : [];
    const listed = probe.list ? await readCompanyList(probe.list) : [];
    return { companies, licence: licence[0] ?? null, listed, problem: null };
  } catch (error) {
    if (!(error instanceof TallyAnswerError)) throw error;
    return { ...empty, problem: error.problem === 'COMPANY_MISSING' ? 'NO_COMPANY' : 'BAD_ANSWER' };
  }
}
const yes = (text: string | undefined) => /^(yes|true|1)$/i.test(text ?? '');

@Injectable()
export class TallyBridge {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyParts) private parts: TallyParts,
  ) {}

  /** A person made the code; only the PC that holds this key can use it, and only once. */
  async pair(body: z.infer<typeof bridgePairSchema>, ip: string) {
    let key;
    try {
      key = createPublicKey({
        key: Buffer.from(body.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      fail('BRIDGE_BAD_SIGNATURE', 'This PC could not prove itself.', 400);
    }
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !ed25519Verify(body.publicKey, bridgePairMessage(body.code, body.publicKey), body.proof)
    )
      fail('BRIDGE_BAD_SIGNATURE', 'This PC could not prove itself.', 400);
    // Charged first, in its own transaction, so wrong guesses still count against the guesser.
    await this.db.atomic(async (tx) => {
      await budget(tx, 'bridge:pair', ip, 30);
      // Across every address too: a code lives 15 minutes, and many machines must not get far either.
      await budget(tx, 'bridge:pair:all', 'store', 500);
    });
    return this.db.atomic(async (tx) => {
      const hashed = pairingHash(body.code);
      const code = await tx.tallyPairingCode.findUnique({ where: { hash: hashed } });
      if (!code || code.usedAt || code.expiresAt <= new Date())
        fail('BRIDGE_BAD_CODE', 'That code is wrong or has run out.', 400);
      if (await tx.tallyDevice.findUnique({ where: { publicKey: body.publicKey } }))
        fail('BRIDGE_KEY_TAKEN', 'This PC is already connected.', 409);
      const device = await tx.tallyDevice.create({
        data: {
          name: code.name,
          locationId: code.locationId,
          publicKey: body.publicKey,
          createdById: code.createdById,
          version: body.version,
          os: cleanText(body.os),
          state: 'PAIRED',
        },
      });
      const used = await tx.tallyPairingCode.updateMany({
        where: { hash: hashed, usedAt: null },
        data: { usedAt: new Date(), usedByDeviceId: device.id },
      });
      if (!used.count) fail('BRIDGE_BAD_CODE', 'That code is wrong or has run out.', 400);
      await tx.auditLog.create({
        data: {
          actorId: `bridge:${device.id}`,
          event: 'TALLY_DEVICE_PAIRED',
          entityId: device.id,
          locationId: code.locationId,
          details: { pairedBy: code.createdById },
        },
      });
      return { deviceId: device.id, name: device.name, serverNow: new Date(), config };
    });
  }

  private async seeCompanies(tx: Tx, device: TallyDevice, probe: Probe, now: Date) {
    const seen: { guid: string; status: string }[] = [];
    for (const row of probe.companies ?? []) {
      const guid = row.guid ?? '';
      const name = row.name ?? '';
      // Nothing a real Tally would write, and the PC could not ask about it by that name anyway.
      if (!guid || !name || guid.length > 200 || name.length > 200) continue;
      const marks = { altMstId: bigOf(row.altMstId), altVchId: bigOf(row.altVchId) };
      const facts = {
        name,
        booksFrom: dayOrNull(row.booksFrom),
        lastVoucherDate: dayOrNull(row.lastVoucherDate),
      };
      const held = await tx.tallyCompany.findUnique({ where: { guid } });
      if (!held) {
        // New to us. A company of this name under another guid means a restore, repair or migration.
        const twin = await tx.tallyCompany.findFirst({
          where: { name, ownerDeviceId: device.id },
          select: { id: true },
        });
        const made = await tx.tallyCompany.create({
          data: {
            guid,
            ...facts,
            ...marks,
            ownerDeviceId: device.id,
            sameNameAsId: twin?.id ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: `bridge:${device.id}`,
            event: 'TALLY_COMPANY_SEEN',
            entityId: made.id,
            details: { sameNameAsId: twin?.id ?? null },
          },
        });
        seen.push({ guid, status: 'WAITING_FOR_PERSON' });
        continue;
      }
      // Decision 39: one PC owns a company. There is no standby, and a person moves it by hand.
      if (held.ownerDeviceId && held.ownerDeviceId !== device.id) {
        seen.push({ guid, status: 'OWNED_ELSEWHERE' });
        continue;
      }
      const backwards = marks.altVchId < held.altVchId || marks.altMstId < held.altMstId;
      const moved = marks.altVchId > held.altVchId || marks.altMstId > held.altMstId;
      const caughtUp = marks.altVchId <= held.wmVchId && marks.altMstId <= held.wmMstId;
      await tx.tallyCompany.update({
        where: { id: held.id },
        data: {
          ...facts,
          ...marks,
          ownerDeviceId: device.id,
          ...(moved
            ? { marksChangedAt: now, marksFirstChangedAt: held.marksFirstChangedAt ?? now }
            : {}),
          // Tally says the mirror is current, so the time beside its numbers moves on.
          ...(held.phase === 'LIVE' && caughtUp && !backwards && !held.rewrittenAt
            ? { freshAt: now }
            : {}),
          ...(backwards
            ? {
                // History was rewritten under us. Stop trusting it, read it all again, keep the links.
                phase: 'MASTERS',
                rewrittenAt: now,
                backfillWindowDays: 7,
                wmMstId: BigInt(0),
                wmVchId: BigInt(0),
                marksChangedAt: null,
                marksFirstChangedAt: null,
                lastSweepOn: null,
                backfillCursor: null,
                tieOut: { status: 'REWRITTEN', at: now.toISOString() },
                tieOutAt: now,
              }
            : {}),
        },
      });
      if (backwards) {
        await tx.tallySyncJob.updateMany({
          where: { companyId: held.id, status: { in: ['QUEUED', 'LEASED', 'UPLOADED'] } },
          data: { status: 'EXPIRED', finishedAt: now, error: 'HISTORY_REWRITTEN' },
        });
        await tx.auditLog.create({
          data: {
            actorId: `bridge:${device.id}`,
            event: 'TALLY_HISTORY_REWRITTEN',
            entityId: held.id,
            details: { from: String(held.altVchId), to: String(marks.altVchId) },
          },
        });
      }
      seen.push({ guid, status: held.role });
    }
    return seen;
  }

  private jobView(job: { id: string; kind: string; companyId: string; reads: unknown }) {
    return { id: job.id, kind: job.kind, reads: job.reads };
  }

  private async nextJob(tx: Tx, device: TallyDevice, now: Date, open: Set<string | undefined>) {
    const active = await tx.tallySyncJob.findFirst({
      where: { deviceId: device.id, status: { in: ['QUEUED', 'LEASED', 'UPLOADED', 'INGESTING'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (active && now.getTime() - active.createdAt.getTime() > JOB_GIVE_UP_MS) {
      await tx.tallySyncJob.update({
        where: { id: active.id },
        data: { status: 'EXPIRED', finishedAt: now, error: 'GAVE_UP' },
      });
    } else if (active) {
      // Waiting for the server's own reading: nothing new for the PC yet.
      if (active.status === 'UPLOADED' || active.status === 'INGESTING') return null;
      await tx.tallySyncJob.update({
        where: { id: active.id },
        data: { status: 'LEASED', leaseUntil: new Date(now.getTime() + LEASE_MS) },
      });
      return this.jobView(active);
    }
    const today = istToday(now);
    const companies = await tx.tallyCompany.findMany({
      where: { ownerDeviceId: device.id, role: 'PRIMARY' },
      orderBy: { createdAt: 'asc' },
    });
    for (const company of companies) {
      // A company closed in Tally cannot answer, and must not hold up one that is open.
      if (!open.has(company.guid)) continue;
      const plan = await this.planFor(tx, company, today, now);
      if (!plan) continue;
      const job = await tx.tallySyncJob.create({
        data: {
          deviceId: device.id,
          companyId: company.id,
          kind: plan.kind,
          reads: plan.reads,
          params: plan.params,
          status: 'LEASED',
          leaseUntil: new Date(now.getTime() + LEASE_MS),
        },
      });
      return this.jobView(job);
    }
    return null;
  }

  private async planFor(tx: Tx, company: TallyCompany, today: string, now: Date) {
    const types = await tx.tallyVoucherType.findMany({
      where: { companyId: company.id, baseType: { not: '' } },
      select: { name: true },
    });
    // A quote mark would break out of the filter on the PC, which refuses it. So it is never sent.
    const copyTypes = types.map((row) => row.name).filter((name) => !name.includes('"'));
    if (!company.copyFrom)
      await tx.tallyCompany.update({
        where: { id: company.id },
        data: { copyFrom: copyFromFor(company, today) },
      });
    return planJob(company, copyTypes, today, now);
  }

  /** Every minute: who is alive, what Tally said, and what to read next. Marks are all it reads here. */
  async heartbeat(deviceId: string, body: z.infer<typeof bridgeHeartbeatSchema>) {
    const probe = await readProbe(body.probe);
    const now = new Date();
    return this.db.atomic(async (tx) => {
      const device = await tx.tallyDevice.findUniqueOrThrow({ where: { id: deviceId } });
      let companies: { guid: string; status: string }[] = [];
      if (probe.companies) companies = await this.seeCompanies(tx, device, probe, now);
      const reachable = probe.companies && probe.companies.length > 0;
      let state: string = body.state;
      if (state === 'OK') {
        if (probe.problem) state = probe.problem;
        else if (probe.companies && !reachable) state = 'NO_COMPANY';
        else if (reachable) {
          const held = await tx.tallyCompany.findMany({
            where: { ownerDeviceId: deviceId, role: 'PRIMARY' },
            select: { guid: true },
          });
          const open = new Set(probe.companies!.map((row) => row.guid));
          if (held.length && !held.some((row) => open.has(row.guid))) state = 'COMPANY_MISSING';
        }
      }
      const before = (device.caps ?? {}) as Record<string, unknown>;
      // The licence is read now and then, not every time: what it last said still holds.
      const licence = probe.licence
        ? {
            release: probe.licence.release ?? '',
            major: probe.licence.major ?? '',
            minor: probe.licence.minor ?? '',
            licensed: yes(probe.licence.licensed),
            educational: yes(probe.licence.educational),
            silver: yes(probe.licence.silver),
            gold: yes(probe.licence.gold),
            editLog: yes(probe.licence.editLog),
          }
        : (before.licence ?? null);
      if (state === 'OK' && (licence as { educational?: boolean } | null)?.educational)
        state = 'EDUCATIONAL';
      const beforeRelease = (before.licence as { release?: string } | null | undefined)?.release;
      const newRelease = licence ? (licence as { release?: string }).release : undefined;
      const releaseChanged = Boolean(beforeRelease && newRelease && beforeRelease !== newRelease);
      const claimed = companies.filter((row) => row.status === 'OWNED_ELSEWHERE').length;
      await tx.tallyDevice.update({
        where: { id: deviceId },
        data: {
          lastHeartbeatAt: now,
          state,
          ...(state !== device.state ? { stateSince: now } : {}),
          ...(reachable ? { lastGoodAt: now } : {}),
          ...(body.woke ? { lastWakeAt: now } : {}),
          version: body.version || device.version,
          os: cleanText(body.os) || device.os,
          caps: {
            ...body.caps,
            licence,
            listed: probe.listed.length,
            claimedElsewhere: claimed,
            ...(releaseChanged
              ? { releaseChangedOn: istToday(now) }
              : before.releaseChangedOn
                ? { releaseChangedOn: before.releaseChangedOn }
                : {}),
          } as Prisma.InputJsonValue,
        },
      });
      const paused = Boolean(device.pausedAt);
      // Tally must be answering, and answering honestly, or there is nothing to ask it.
      const job =
        !paused && reachable && (state === 'OK' || state === 'EDUCATIONAL')
          ? await this.nextJob(tx, device, now, new Set(probe.companies!.map((row) => row.guid)))
          : null;
      return {
        serverNow: now,
        paused,
        job,
        companies,
        config,
        update:
          device.targetVersion && device.targetVersion !== body.version
            ? { version: device.targetVersion }
            : null,
      };
    });
  }

  private async ownJob(deviceId: string, jobId: string) {
    const job = await this.db.tallySyncJob.findUnique({ where: { id: jobId } });
    // Another PC's job looks exactly like no job at all.
    if (!job || job.deviceId !== deviceId) fail('NOT_FOUND', 'That job is not here.', 404);
    return job;
  }

  /** Safe to send twice and in any order. The same part twice is fine; a different one is not. */
  async putChunk(deviceId: string, jobId: string, seqText: string, bytes: Buffer, sha256: string) {
    if (!/^\d{1,4}$/.test(seqText) || Number(seqText) > 4095)
      fail('BRIDGE_BAD_PART', 'That part number is not right.', 400);
    const seq = Number(seqText);
    const job = await this.ownJob(deviceId, jobId);
    const held = await this.db.tallyChunk.findUnique({ where: { jobId_seq: { jobId, seq } } });
    if (held) {
      if (held.sha256 !== sha256)
        fail('BRIDGE_PART_CHANGED', 'A different part with this number already arrived.', 409);
      return { ok: true, duplicate: true };
    }
    if (!['QUEUED', 'LEASED'].includes(job.status))
      fail('BRIDGE_JOB_CLOSED', 'This job is closed.', 409, { status: job.status });
    if (!bytes.length || bytes.length > PART_LIMIT)
      fail('BRIDGE_BAD_PART', 'That part is empty or too big.', 400);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
      fail('BRIDGE_BAD_PART', 'That part is not gzip.', 400);
    await this.db.atomic((tx) =>
      budget(
        tx,
        'bridge:bytes',
        deviceId,
        DAILY_UPLOAD_KB,
        86400000,
        Math.ceil(bytes.length / 1024),
      ),
    );
    const storageKey = `tally-parts/${jobId}/${seq}-${sha256}.gz`;
    await this.parts.put(storageKey, bytes);
    await this.db.tallyChunk.createMany({
      data: [
        {
          jobId,
          seq,
          sha256,
          storageKey,
          size: bytes.length,
          expiresAt: new Date(Date.now() + CHUNK_KEPT_MS),
        },
      ],
      skipDuplicates: true,
    });
    return { ok: true, duplicate: false };
  }

  /** All parts here, or it says which are missing. Reading happens later, on the worker. */
  async finish(deviceId: string, jobId: string, body: z.infer<typeof bridgeFinishSchema>) {
    const job = await this.ownJob(deviceId, jobId);
    if (!['QUEUED', 'LEASED'].includes(job.status))
      return { status: job.status, repeat: true, error: job.error };
    if (body.error) {
      await this.db.$transaction(async (tx) => {
        await tx.tallySyncJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', error: body.error, finishedAt: new Date(), leaseUntil: null },
        });
        await tx.tallyCompany.update({
          where: { id: job.companyId },
          data: {
            failures: { increment: 1 },
            lastError: body.error,
            lastFailureAt: new Date(),
          },
        });
      });
      return { status: 'FAILED', error: body.error };
    }
    const reads = job.reads as ReadSpec[];
    const wanted = new Set<number>();
    for (const [index, spec] of reads.entries()) {
      if (!tallyReadNames.includes(spec.read as TallyReadName))
        fail('BRIDGE_BAD_BODY', 'This job is not one of ours.', 400);
      const read = body.reads.find((entry) => entry.index === index);
      if (!read || !read.parts.length)
        fail('BRIDGE_PARTS_MISSING', 'Some answers are missing.', 409, { missingRead: index });
      for (const part of read.parts) wanted.add(part.seq);
    }
    const chunks = await this.db.tallyChunk.findMany({ where: { jobId } });
    const bySeq = new Map(chunks.map((chunk) => [chunk.seq, chunk.sha256]));
    const missing: number[] = [];
    for (const read of body.reads)
      for (const part of read.parts)
        if (bySeq.get(part.seq) !== part.sha256) missing.push(part.seq);
    if (missing.length)
      fail('BRIDGE_PARTS_MISSING', 'Some parts are missing.', 409, {
        missing: missing.slice(0, 200),
      });
    const moved = await this.db.tallySyncJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'LEASED'] } },
      data: {
        status: 'UPLOADED',
        uploadedAt: new Date(),
        leaseUntil: null,
        report: { reads: body.reads, marksAfter: body.marksAfter ?? null } as Prisma.InputJsonValue,
      },
    });
    return { status: moved.count ? 'UPLOADED' : job.status, parts: wanted.size };
  }

  /** The bytes of a release a person chose for this PC. The PC checks the signature itself. */
  async release(deviceId: string, version: string) {
    const device = await this.db.tallyDevice.findUniqueOrThrow({ where: { id: deviceId } });
    if (device.targetVersion !== version)
      fail('BRIDGE_NO_RELEASE', 'That release is not meant for this PC.', 404);
    const release = await this.db.tallyRelease.findUnique({ where: { version } });
    if (!release) fail('BRIDGE_NO_RELEASE', 'That release is not here.', 404);
    return {
      version: release.version,
      manifest: release.manifest,
      signature: release.signature,
      files: release.files,
    };
  }
}

@ApiTags('Tally bridge')
@Controller('bridge')
export class BridgeOpenController {
  constructor(@Inject(TallyBridge) private bridge: TallyBridge) {}
  // Only the time: how the check tool proves its clock and its TLS, and tells nothing else.
  @Public() @Get('time') time() {
    return { serverNow: new Date() };
  }
  // Eight digits, fifteen minutes, one use, and few tries: a guess has no realistic chance.
  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60000 } })
  @Post('pair')
  @Contract(bridgePairSchema)
  pair(@Input(bridgePairSchema) body: z.infer<typeof bridgePairSchema>, @Req() req: Request) {
    return this.bridge.pair(body, clientIp(req));
  }
}

@ApiTags('Tally bridge')
@Public()
@UseGuards(BridgeGuard)
@Controller('bridge')
export class BridgeController {
  constructor(@Inject(TallyBridge) private bridge: TallyBridge) {}
  @Post('heartbeat') @Contract(bridgeHeartbeatSchema) heartbeat(@Req() req: BridgeRequest) {
    return this.bridge.heartbeat(req.bridge!.deviceId, jsonBody(req, bridgeHeartbeatSchema));
  }
  @Put('jobs/:id/chunks/:seq') chunk(
    @Param('id') id: string,
    @Param('seq') seq: string,
    @Req() req: BridgeRequest,
  ) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.bridge.putChunk(req.bridge!.deviceId, id, seq, body, hash(body));
  }
  @Post('jobs/:id/finish') @Contract(bridgeFinishSchema) finish(
    @Param('id') id: string,
    @Req() req: BridgeRequest,
  ) {
    return this.bridge.finish(req.bridge!.deviceId, id, jsonBody(req, bridgeFinishSchema));
  }
  @Get('releases/:version') release(@Param('version') version: string, @Req() req: BridgeRequest) {
    return this.bridge.release(req.bridge!.deviceId, version);
  }
}

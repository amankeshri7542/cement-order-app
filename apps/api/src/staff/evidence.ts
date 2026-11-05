import { Controller, Get, Inject, Injectable, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { canDo, geoRetentionDays } from '@shiv/shared';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { Db } from '../db';
import { AuthRequest, Can, fail, forbid, scoped } from '../http';
import { productPhoto } from '../product-assets';
import { RateStorage } from '../rate-studio/storage';

const kinds = ['ATTENDANCE_PHOTO', 'KANTA_SLIP', 'DAMAGE_PHOTO', 'DELIVERY_PHOTO'] as const;

/** A photo named on a record must be a real one, sent by the person making the record. */
export async function evidenceExists(db: Pick<Db, 'evidenceObject'>, id: string, ownerId: string) {
  const row = await db.evidenceObject.findFirst({
    where: { id, createdById: ownerId },
    select: { id: true },
  });
  if (!row) fail('INVALID_INPUT', 'That photo did not reach the shop. Add it again.', 400);
}

/** Private photos. Never a public address: each read goes through here, and is on the record. */
@Injectable()
export class Evidence {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RateStorage) private storage: RateStorage,
  ) {}
  async add(
    bytes: Buffer,
    contentType: string,
    kind: string,
    locationId: string | undefined,
    actorId: string,
  ) {
    if (!kinds.includes(kind as (typeof kinds)[number]))
      fail('INVALID_INPUT', 'Unknown photo kind.');
    // Re-encoding removes location data and anything else hiding in the file.
    const clean = await productPhoto(bytes, contentType);
    const sha256 = createHash('sha256').update(clean).digest('hex');
    const storageKey = `${sha256}.webp`;
    await this.storage.put(storageKey, clean, 'image/webp');
    const retainUntil = new Date(Date.now() + geoRetentionDays * 86400000);
    const row = await this.db.evidenceObject.upsert({
      where: { storageKey },
      // The same picture sent again is the same file: it now lasts as long as the newest record.
      update: { retainUntil, erasedAt: null },
      create: {
        kind,
        storageKey,
        sha256,
        contentType: 'image/webp',
        size: clean.length,
        locationId: locationId ?? null,
        createdById: actorId,
        retainUntil,
      },
    });
    return { id: row.id };
  }
  /**
   * Past its keeping date a photo goes for good, and only the row saying it existed stays. A file
   * the store will not delete is put back on the list, so tomorrow's run tries again.
   */
  async sweep(now = new Date()) {
    const due = await this.db.evidenceObject.findMany({
      where: { retainUntil: { lt: now }, erasedAt: null },
      select: { id: true, storageKey: true },
      take: 200,
    });
    let erased = 0;
    for (const row of due) {
      const claimed = await this.db.evidenceObject.updateMany({
        where: { id: row.id, retainUntil: { lt: now }, erasedAt: null },
        data: { erasedAt: now },
      });
      if (!claimed.count) continue;
      try {
        // Identical bytes share one file, and a rate sheet may be holding the same one.
        const shared = await this.db.rateSource.count({ where: { storageKey: row.storageKey } });
        if (!shared) await this.storage.remove(row.storageKey);
        erased += 1;
      } catch {
        await this.db.evidenceObject.update({ where: { id: row.id }, data: { erasedAt: null } });
      }
    }
    return erased;
  }
  async read(id: string, req: AuthRequest) {
    const row = await this.db.evidenceObject.findUnique({ where: { id } });
    if (!row || row.erasedAt) fail('NOT_FOUND', 'That photo is not here.', 404);
    const allowed =
      row.createdById === req.user.id ||
      (row.locationId
        ? canDo(req.access, 'attendance.review', row.locationId) ||
          canDo(req.access, 'approvals.decide', row.locationId)
        : req.access['attendance.review'] === 'ALL');
    if (!allowed) forbid(req, 'attendance.review');
    await this.db.auditLog.create({
      data: {
        actorId: req.user.id,
        event: 'EVIDENCE_READ',
        entityId: id,
        locationId: row.locationId,
        details: { kind: row.kind },
      },
    });
    return { bytes: await this.storage.get(row.storageKey), contentType: row.contentType };
  }
}

@ApiTags('Staff app')
@Controller()
export class EvidenceController {
  constructor(@Inject(Evidence) private evidence: Evidence) {}
  @Can('staffapp.use', scoped) @Post('staff/evidence') add(
    @Query('kind') kind: string,
    @Query('locationId') locationId: string | undefined,
    @Req() req: AuthRequest,
  ) {
    if (!Buffer.isBuffer(req.body)) fail('INVALID_IMAGE', 'Upload image bytes.');
    if (locationId && !canDo(req.access, 'staffapp.use', locationId)) forbid(req, 'staffapp.use');
    return this.evidence.add(
      req.body,
      String(req.headers['content-type'] ?? '').split(';')[0] ?? '',
      kind,
      locationId,
      req.user.id,
    );
  }
  @Can('attendance.read', scoped) @Get('admin/evidence/:id') async read(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const file = await this.evidence.read(id, req);
    res
      .status(200)
      .type(file.contentType)
      .setHeader('Cache-Control', 'private, no-store')
      .send(file.bytes);
  }
}

import { Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { firmCreateSchema, firmUpdateSchema, istToday } from '@shiv/shared';
import { Db } from './db';
import { financialYear } from './firms';
import { AuthRequest, Can, Contract, fail, Input } from './http';

type Tx = Prisma.TransactionClient;

const firmView = {
  id: true,
  legalName: true,
  tradeName: true,
  gstin: true,
  address: true,
  billPrefix: true,
  upiId: true,
  active: true,
  createdAt: true,
  locations: {
    select: { id: true, name: true, kind: true, siteId: true, active: true },
    orderBy: { createdAt: 'asc' },
  },
  billSeries: {
    select: { financialYear: true, prefix: true, nextNumber: true },
    orderBy: { financialYear: 'desc' },
  },
} satisfies Prisma.FirmSelect;

/** This year's bill series for a firm, made when its prefix is first set. Numbers start at 1. */
async function ensureSeries(tx: Tx, firmId: string, prefix: string) {
  const year = financialYear(istToday());
  await tx.billSeries.upsert({
    where: { firmId_financialYear: { firmId, financialYear: year } },
    create: { firmId, financialYear: year, prefix },
    update: {},
  });
}

/**
 * Settings → Dukaan aur firm: the firms and which shops belong to each (plan v4, two firms). A
 * firm is never deleted, only closed, because its records stay. Its bill prefix is set once a bill
 * has been numbered, and a GSTIN belongs to one firm only.
 */
@ApiTags('Firms')
@Controller('admin/firms')
export class FirmSettingsController {
  constructor(@Inject(Db) private db: Db) {}

  @Can('location.manage')
  @Get()
  list() {
    return this.db.firm.findMany({ select: firmView, orderBy: { createdAt: 'asc' } });
  }

  @Can('location.manage')
  @Post()
  @Contract(firmCreateSchema)
  create(@Input(firmCreateSchema) body: z.infer<typeof firmCreateSchema>, @Req() req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      await this.unique(tx, body, null);
      const firm = await tx.firm.create({
        data: { ...body, billPrefix: body.billPrefix ?? '' },
        select: { id: true },
      });
      if (body.billPrefix) await ensureSeries(tx, firm.id, body.billPrefix);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'FIRM_ADDED',
          entityId: firm.id,
          details: { legalName: body.legalName, billPrefix: body.billPrefix ?? '' },
        },
      });
      return tx.firm.findUniqueOrThrow({ where: { id: firm.id }, select: firmView });
    });
  }

  @Can('location.manage')
  @Patch(':id')
  @Contract(firmUpdateSchema)
  update(
    @Param('id') id: string,
    @Input(firmUpdateSchema) body: z.infer<typeof firmUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const before = await tx.firm.findUnique({ where: { id } });
      if (!before) fail('FIRM_NOT_FOUND', 'Firm not found.', 404);
      await this.unique(tx, body, id);
      if (body.billPrefix !== undefined && body.billPrefix !== before.billPrefix) {
        // Bills already numbered keep their prefix, so it cannot move once one exists.
        const used = await tx.billSeries.count({ where: { firmId: id, nextNumber: { gt: 1 } } });
        if (used)
          fail('PREFIX_IN_USE', 'Bills already carry this prefix. It cannot change now.', 409);
      }
      if (body.active === false) {
        const open = await tx.firm.count({ where: { active: true, id: { not: id } } });
        if (!open) fail('LAST_FIRM', 'Keep at least one firm open.', 409);
        const shops = await tx.location.count({ where: { firmId: id, active: true } });
        if (shops) fail('FIRM_HAS_SHOPS', 'Close this firm’s shops first.', 409);
      }
      await tx.firm.update({ where: { id }, data: body });
      const prefix = body.billPrefix ?? before.billPrefix;
      if (prefix) await ensureSeries(tx, id, prefix);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'FIRM_UPDATED',
          entityId: id,
          details: { changed: Object.keys(body) },
        },
      });
      return tx.firm.findUniqueOrThrow({ where: { id }, select: firmView });
    });
  }

  /** One GSTIN and one bill prefix per firm, so two firms never print the same. */
  private async unique(
    tx: Tx,
    body: { gstin?: string | null; billPrefix?: string },
    id: string | null,
  ) {
    const not = id ? { id: { not: id } } : {};
    if (body.gstin && (await tx.firm.count({ where: { gstin: body.gstin, ...not } })))
      fail('GSTIN_IN_USE', 'Another firm has this GSTIN.', 409);
    if (
      body.billPrefix &&
      (await tx.firm.count({ where: { billPrefix: body.billPrefix, ...not } }))
    )
      fail('PREFIX_IN_USE', 'Another firm uses this bill prefix.', 409);
  }
}

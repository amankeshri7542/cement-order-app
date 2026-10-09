import { budget } from '../abuse';
import { getConfig } from '../config';
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  Res,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  rateBatchCreateSchema,
  rateBatchSaveSchema,
  rateVersionSchema,
  ratePublishSchema,
  rateAdjustmentSchema,
  rateCardSchema,
  rateExtractionSchema,
  type RateIssue,
} from '@shiv/shared';
import { Db } from '../db';
import { Admin, AuthRequest, Contract, Input, fail } from '../http';
import { Events } from '../catalog';
import { paginate } from '../pagination';
import { RateProviders, RateProviderError } from './providers';
import { RateStorage } from './storage';
import {
  adjustedPrice,
  extractionAlias,
  matchRate,
  normalizeAlias,
  rowIssues,
  rupeesToPaise,
} from './rules';
import { renderRateCardPages, rateCardPng, type CardSnapshot } from './cards';
const detailInclude = {
  source: true,
  items: { orderBy: { position: 'asc' as const }, include: { product: true } },
  cards: { orderBy: { createdAt: 'desc' as const } },
};
type Batch = Prisma.PriceUpdateBatchGetPayload<{ include: typeof detailInclude }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function editable(batch: { status: string; version: number }, version: number) {
  if (['PUBLISHED', 'CANCELLED'].includes(batch.status))
    fail('BATCH_LOCKED', 'This batch is closed. Create a new price sheet.', 409);
  if (batch.status === 'PROCESSING')
    fail('BATCH_PROCESSING', 'Extraction is still running. Wait or retry after recovery.', 409);
  if (batch.version !== version)
    fail(
      'BATCH_CONFLICT',
      'Another staff member changed this draft. Reload the saved draft before continuing.',
      409,
    );
}
function issuesFor(batch: Pick<Batch, 'items'>) {
  const counts = new Map<string, number>();
  for (const row of batch.items)
    if (row.included && row.productId)
      counts.set(row.productId, (counts.get(row.productId) || 0) + 1);
  return batch.items.map((row) => ({
    ...row,
    issues: rowIssues(row, Boolean(row.productId && (counts.get(row.productId) || 0) > 1)),
  }));
}
function batchIssues(items: ReturnType<typeof issuesFor>): RateIssue[] {
  if (!items.some((i) => i.included))
    return [
      { code: 'EMPTY_BATCH', message: 'Include at least one reviewed price.', blocking: true },
    ];
  return items.flatMap((i) =>
    i.issues.map((issue) => ({
      ...issue,
      message: `${i.label || i.product?.name || 'Row ' + (i.position + 1)}: ${issue.message}`,
    })),
  );
}
function ready(items: ReturnType<typeof issuesFor>) {
  return (
    items.some((i) => i.included) &&
    items.every(
      (i) =>
        !i.included || (!i.issues.some((w) => w.blocking) && (!i.issues.length || i.acknowledged)),
    )
  );
}
@Injectable()
export class RateStudioService {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Events) private events: Events,
    @Inject(RateProviders) private providers: RateProviders,
    @Inject(RateStorage) private storage: RateStorage,
  ) {}
  async recover(id: string) {
    await this.db.priceUpdateBatch.updateMany({
      where: { id, status: 'PROCESSING', leaseUntil: { lt: new Date() } },
      data: {
        status: 'REVIEW_REQUIRED',
        stage: '',
        attemptToken: null,
        leaseUntil: null,
        errorCode: 'PROCESS_INTERRUPTED',
        version: { increment: 1 },
      },
    });
  }
  async get(id: string) {
    await this.recover(id);
    const batch = await this.db.priceUpdateBatch.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    });
    // Historical warnings refer to the reviewed product, not today's mutable catalogue.
    const items = issuesFor(
      batch.status === 'PUBLISHED'
        ? {
            items: batch.items.map((item) =>
              item.publishedProduct && item.product
                ? {
                    ...item,
                    product: {
                      ...item.product,
                      ...(item.publishedProduct as Record<string, unknown>),
                      version: item.expectedProductVersion!,
                      active: true,
                    },
                  }
                : item,
            ),
          }
        : batch,
    );
    const approver = batch.publishedBy
      ? await this.db.user.findUnique({ where: { id: batch.publishedBy }, select: { name: true } })
      : null;
    const source = batch.source
      ? {
          id: batch.source.id,
          fileName: batch.source.fileName,
          contentType: batch.source.contentType,
          size: batch.source.size,
          sha256: batch.source.sha256,
          ocrText: batch.source.ocrText,
          ocr: batch.source.ocr,
        }
      : null;
    return {
      ...batch,
      publishedByName: approver?.name || null,
      source,
      items: items.map((i) => ({ ...i, refreshBaseline: false })),
      itemCount: items.length,
      issues: batchIssues(items),
      attemptToken: undefined,
      leaseUntil: undefined,
    };
  }
  async create(
    body: z.infer<typeof rateBatchCreateSchema>,
    actor: string,
  ): Promise<Awaited<ReturnType<RateStudioService['get']>>> {
    const prior = await this.db.priceUpdateBatch.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    });
    if (prior) {
      if (
        prior.createdBy !== actor ||
        prior.title !== body.title ||
        prior.sourceType !== body.sourceType
      )
        fail('IDEMPOTENCY_CONFLICT', 'This create key belongs to a different request.', 409);
      return this.get(prior.id);
    }
    try {
      const batch = await this.db.atomic(async (tx) => {
        const created = await tx.priceUpdateBatch.create({ data: { ...body, createdBy: actor } });
        await tx.auditLog.create({
          data: {
            actorId: actor,
            event: 'RATE_BATCH_CREATED',
            entityId: created.id,
            details: { sourceType: body.sourceType },
          },
        });
        return created;
      });
      return this.get(batch.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return this.create(body, actor);
      throw e;
    }
  }
  async save(id: string, body: z.infer<typeof rateBatchSaveSchema>, actor: string) {
    await this.db.atomic(async (tx) => {
      const batch = await tx.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      });
      editable(batch, body.expectedVersion);
      const seen = new Set<string>();
      const prepared = [];
      for (let position = 0; position < body.items.length; position++) {
        const input = body.items[position]!;
        const old = input.id ? batch.items.find((i) => i.id === input.id) : undefined;
        if (input.id && (!old || seen.has(input.id)))
          fail('INVALID_ROW', 'Reload the draft; a row is invalid.');
        if (input.id) seen.add(input.id);
        const product = input.productId
          ? await tx.product.findUniqueOrThrow({ where: { id: input.productId } })
          : null;
        const same = old?.productId === input.productId && !input.refreshBaseline;
        if (
          product &&
          (!old || old.productId !== input.productId) &&
          input.expectedProductVersion != null &&
          product.version !== input.expectedProductVersion
        )
          fail(
            'PRODUCT_CONFLICT',
            'The selected product changed. Choose it again and review its current price.',
            409,
          );
        const {
          id: rowId,
          refreshBaseline: _refresh,
          expectedProductVersion: _expected,
          ...data
        } = input;
        if (
          (input.refreshBaseline && old?.productId === input.productId) ||
          (!old && input.expectedProductVersion == null)
        ) {
          data.reviewed = false;
          data.acknowledged = false;
        }
        prepared.push({
          ...data,
          id: rowId,
          position,
          oldPricePaise: same ? (old?.oldPricePaise ?? null) : (product?.pricePaise ?? null),
          expectedProductVersion: same
            ? (old?.expectedProductVersion ?? null)
            : (product?.version ?? null),
          confidence: old?.confidence ?? null,
          matchMethod: old?.productId === input.productId ? old.matchMethod : 'MANUAL',
          extracted: old?.extracted === null || !old ? Prisma.JsonNull : json(old.extracted),
        });
      }
      await tx.priceUpdateBatchItem.deleteMany({ where: { batchId: id } });
      if (prepared.length)
        await tx.priceUpdateBatchItem.createMany({
          data: prepared.map((row) => ({ ...row, batchId: id })),
        });
      const saved = await tx.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      });
      const rows = issuesFor(saved);
      await tx.priceUpdateBatch.update({
        where: { id },
        data: {
          title: body.title,
          status: ready(rows) ? 'READY' : rows.length ? 'REVIEW_REQUIRED' : 'DRAFT',
          version: { increment: 1 },
          errorCode: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'RATE_BATCH_REVIEWED',
          entityId: id,
          details: { rows: rows.length, reviewed: rows.filter((r) => r.reviewed).length },
        },
      });
    });
    return this.get(id);
  }
  async adjust(id: string, body: z.infer<typeof rateAdjustmentSchema>, actor: string) {
    if (new Set(body.productIds).size !== body.productIds.length)
      fail('DUPLICATE_PRODUCTS', 'Choose each product once.');
    if (body.kind === 'PERCENT' && body.amount > 100_000)
      fail('INVALID_ADJUSTMENT', 'Percentage must be between 0.01% and 1000%.');
    await this.db.atomic(async (tx) => {
      const batch = await tx.priceUpdateBatch.findUniqueOrThrow({ where: { id } });
      editable(batch, body.expectedVersion);
      const products = await tx.product.findMany({
        where: { id: { in: body.productIds }, active: true },
        orderBy: { name: 'asc' },
      });
      if (products.length !== body.productIds.length)
        fail('INVALID_PRODUCTS', 'One or more selected products are unavailable.');
      const rows = products.map((p, position) => ({
        batchId: id,
        position,
        productId: p.id,
        label: p.name,
        brand: p.brand,
        specification: [p.grade, p.type, p.packSize].filter(Boolean).join(' · ').slice(0, 160),
        unit: p.unit,
        proposedPricePaise: adjustedPrice(p.pricePaise, body.kind, body.direction, body.amount),
        oldPricePaise: p.pricePaise,
        expectedProductVersion: p.version,
        matchMethod: 'ADJUSTMENT',
        note: `${body.direction} ${body.amount} ${body.kind === 'FIXED' ? 'paise' : 'basis points'}`,
      }));
      if (rows.some((r) => r.proposedPricePaise === null))
        fail('INVALID_PRICE', 'Adjustment would produce a zero, negative or excessive price.');
      await tx.priceUpdateBatchItem.deleteMany({ where: { batchId: id } });
      await tx.priceUpdateBatchItem.createMany({ data: rows });
      await tx.priceUpdateBatch.update({
        where: { id },
        data: { status: 'REVIEW_REQUIRED', version: { increment: 1 }, errorCode: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'RATE_ADJUSTMENT_PREVIEWED',
          entityId: id,
          details: {
            kind: body.kind,
            direction: body.direction,
            amount: body.amount,
            count: rows.length,
          },
        },
      });
    });
    return this.get(id);
  }
  async upload(
    id: string,
    version: number,
    bytes: Buffer,
    type: string,
    fileName: string,
    actor: string,
  ) {
    if (!Buffer.isBuffer(bytes)) fail('INVALID_IMAGE', 'Upload JPEG, PNG or WebP image bytes.');
    const meta = await this.storage.validate(bytes, type);
    const token = randomUUID();
    await this.db.atomic(async (tx) => {
      const b = await tx.priceUpdateBatch.findUniqueOrThrow({ where: { id } });
      editable(b, version);
      if (b.sourceId)
        fail(
          'SOURCE_LOCKED',
          'This batch already has an immutable source. Create another batch to use a different sheet.',
          409,
        );
      await tx.priceUpdateBatch.update({
        where: { id },
        data: {
          status: 'PROCESSING',
          stage: 'UPLOADING',
          attemptToken: token,
          leaseUntil: new Date(Date.now() + 180000),
          version: { increment: 1 },
        },
      });
    });
    const ext = (
      { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>
    )[meta.contentType];
    const storageKey = `${meta.sha256}.${ext}`;
    try {
      let source = await this.db.rateSource.findUnique({ where: { sha256: meta.sha256 } });
      if (!source) {
        await this.storage.put(storageKey, bytes, meta.contentType);
        source = await this.db.rateSource.upsert({
          where: { sha256: meta.sha256 },
          update: {},
          create: {
            ...meta,
            storageKey,
            fileName: fileName.slice(0, 160) || 'Rate sheet',
            createdBy: actor,
          },
        });
      }
      await this.db.atomic(async (tx) => {
        const changed = await tx.priceUpdateBatch.updateMany({
          where: { id, status: 'PROCESSING', attemptToken: token },
          data: {
            sourceId: source.id,
            status: 'DRAFT',
            stage: '',
            attemptToken: null,
            leaseUntil: null,
            errorCode: null,
            version: { increment: 1 },
          },
        });
        if (!changed.count)
          fail('BATCH_CONFLICT', 'Upload attempt expired. Reload the batch.', 409);
        await tx.auditLog.create({
          data: {
            actorId: actor,
            event: 'RATE_SOURCE_ATTACHED',
            entityId: id,
            details: { sourceId: source.id, sha256: meta.sha256, size: meta.size },
          },
        });
      });
    } catch (e) {
      await this.db.priceUpdateBatch.updateMany({
        where: { id, attemptToken: token, status: 'PROCESSING' },
        data: {
          status: 'REVIEW_REQUIRED',
          stage: '',
          attemptToken: null,
          leaseUntil: null,
          errorCode: 'SOURCE_UPLOAD_FAILED',
          version: { increment: 1 },
        },
      });
      if (e instanceof RateProviderError)
        fail(e.code, 'Source upload failed. Retry the upload or continue manually.', 503);
      fail(
        'SOURCE_UPLOAD_FAILED',
        'Source upload failed. Retry the upload or continue manually.',
        503,
      );
    }
    return this.get(id);
  }
  async start(id: string, version: number, actor: string) {
    await this.recover(id);
    const token = randomUUID();
    await this.db.atomic(async (tx) => {
      const b = await tx.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: { source: true, items: true },
      });
      editable(b, version);
      if (!b.source) fail('SOURCE_REQUIRED', 'Upload a source image first.');
      if (b.items.length || b.extraction)
        fail(
          'EXTRACTION_EXISTS',
          'Existing rows are preserved. Review them or create a new batch.',
          409,
        );
      if (
        (await tx.auditLog.count({
          where: {
            actorId: actor,
            event: 'RATE_EXTRACTION_STARTED',
            createdAt: { gte: new Date(Date.now() - 3600000) },
          },
        })) >= 20
      )
        fail(
          'EXTRACTION_BUDGET',
          'Twenty extraction attempts per staff member per hour. Continue manually or retry later.',
          429,
        );
      if (
        (await tx.priceUpdateBatch.count({
          where: { status: 'PROCESSING', leaseUntil: { gt: new Date() } },
        })) >= 2
      )
        fail('EXTRACTION_BUSY', 'Two sheets are processing. Wait for one to finish.', 429);
      if (getConfig().EXTRACTION_PAUSED)
        fail('EXTRACTION_PAUSED', 'Extraction paused. Continue manually.', 503);
      await budget(tx, 'extraction:global', 'store', getConfig().EXTRACTIONS_PER_DAY, 86400000);
      if (b.attempts >= 5)
        fail('EXTRACTION_LIMIT', 'This batch reached five extraction attempts. Continue manually.');
      await tx.priceUpdateBatch.update({
        where: { id },
        data: {
          status: 'PROCESSING',
          stage: b.source.ocrText ? 'INTERPRETING' : 'READING_SOURCE',
          attemptToken: token,
          leaseUntil: new Date(Date.now() + 360000),
          attempts: { increment: 1 },
          errorCode: null,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'RATE_EXTRACTION_STARTED',
          entityId: id,
          details: { attempt: b.attempts + 1 },
        },
      });
    });
    // ponytail: single API process; persisted leases recover interrupted work without a queue.
    void this.process(id, token).catch(() =>
      console.error(JSON.stringify({ event: 'RATE_PROCESS_RECOVERY_REQUIRED', batchId: id })),
    );
    return this.get(id);
  }
  async process(id: string, token: string) {
    const began = Date.now();
    try {
      const b = await this.db.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: { source: true },
      });
      if (b.attemptToken !== token || b.status !== 'PROCESSING' || !b.source) return;
      let text = b.source.ocrText;
      let layout: unknown = b.source.ocr;
      let usage: Record<string, number | string> = {};
      if (!text) {
        const bytes = await this.storage.get(b.source.storageKey);
        const result = await this.providers.ocr(bytes);
        text = result.text;
        layout = json(result.layout);
        usage = { ...result.usage };
        const stored = await this.db.atomic(async (tx) => {
          const active = await tx.priceUpdateBatch.findFirst({
            where: {
              id,
              attemptToken: token,
              status: 'PROCESSING',
              leaseUntil: { gt: new Date() },
            },
          });
          if (!active) return null;
          await tx.rateSource.updateMany({
            where: { id: b.source!.id, ocrText: null },
            data: { ocrText: result.text, ocr: json(result.layout) },
          });
          await tx.priceUpdateBatch.update({
            where: { id },
            data: { stage: 'INTERPRETING', usage: json(usage) },
          });
          return tx.rateSource.findUniqueOrThrow({ where: { id: b.source!.id } });
        });
        if (!stored) return;
        text = stored.ocrText!;
        layout = stored.ocr;
      }
      if (
        !(await this.db.priceUpdateBatch.findFirst({
          where: { id, attemptToken: token, status: 'PROCESSING', leaseUntil: { gt: new Date() } },
        }))
      )
        return;
      const result = await this.providers.interpret(text, layout);
      const extraction = rateExtractionSchema.parse(result.extraction);
      usage = { ...usage, ...result.usage, durationMs: Date.now() - began };
      await this.db.atomic(async (tx) => {
        const current = await tx.priceUpdateBatch.findUniqueOrThrow({ where: { id } });
        if (
          current.attemptToken !== token ||
          current.status !== 'PROCESSING' ||
          !current.leaseUntil ||
          current.leaseUntil < new Date()
        )
          return;
        for (let position = 0; position < extraction.rows.length; position++) {
          const row = extraction.rows[position]!;
          const match = await matchRate(tx, row);
          const p = match.product;
          await tx.priceUpdateBatchItem.create({
            data: {
              batchId: id,
              position,
              productId: p?.id,
              label: row.product || '',
              brand: row.brand || '',
              specification: [row.size, row.specification]
                .filter(Boolean)
                .join(' · ')
                .slice(0, 160),
              unit: row.unit || '',
              weight: row.weight || '',
              proposedPricePaise: rupeesToPaise(row.price),
              oldPricePaise: p?.pricePaise,
              expectedProductVersion: p?.version,
              confidence: row.confidence,
              matchMethod: match.method,
              extracted: json(row),
              note: row.deliveryNotes || '',
            },
          });
        }
        await tx.priceUpdateBatch.update({
          where: { id },
          data: {
            status: 'REVIEW_REQUIRED',
            stage: '',
            attemptToken: null,
            leaseUntil: null,
            extraction: json(extraction),
            usage: json(usage),
            errorCode: extraction.rows.length ? null : 'NO_RATES_DETECTED',
            version: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: current.createdBy,
            event: 'RATE_EXTRACTION_COMPLETED',
            entityId: id,
            details: { rows: extraction.rows.length, usage: json(usage) },
          },
        });
      });
    } catch (e) {
      const code =
        e instanceof RateProviderError
          ? e.code
          : e instanceof z.ZodError
            ? 'INVALID_EXTRACTION'
            : 'EXTRACTION_FAILED';
      await this.db.priceUpdateBatch.updateMany({
        where: { id, attemptToken: token, status: 'PROCESSING' },
        data: {
          status: 'REVIEW_REQUIRED',
          stage: '',
          attemptToken: null,
          leaseUntil: null,
          errorCode: code,
          version: { increment: 1 },
        },
      });
      console.warn(
        JSON.stringify({
          event: 'RATE_EXTRACTION_FAILED',
          batchId: id,
          code,
          durationMs: Date.now() - began,
        }),
      );
    }
  }
  async publish(id: string, version: number, actor: string) {
    const changed = await this.db.atomic(async (tx) => {
      const b = await tx.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      });
      if (b.status === 'PUBLISHED') return false;
      editable(b, version);
      const rows = issuesFor(b);
      if (!ready(rows))
        fail(
          'REVIEW_REQUIRED',
          'Resolve blocking rows, review selected prices and acknowledge warnings before publishing.',
          409,
        );
      for (const row of rows.filter((r) => r.included)) {
        const p = row.product!;
        const monetary = p.pricePaise !== row.proposedPricePaise;
        const changed = monetary
          ? await tx.product.updateMany({
              where: { id: p.id, version: row.expectedProductVersion!, active: true },
              data: {
                pricePaise: row.proposedPricePaise!,
                priceVersion: { increment: 1 },
                version: { increment: 1 },
                priceUpdatedAt: new Date(),
              },
            })
          : { count: 1 };
        if (changed.count !== 1)
          fail('PRODUCT_CONFLICT', `${p.name} changed. Reload and review the batch.`, 409);
        const saved = await tx.product.findUniqueOrThrow({ where: { id: p.id } });
        if (monetary)
          await tx.productPriceHistory.create({
            data: {
              productId: p.id,
              batchId: id,
              oldPricePaise: p.pricePaise,
              newPricePaise: saved.pricePaise,
              version: saved.priceVersion,
              actorId: actor,
            },
          });
        await tx.priceUpdateBatchItem.update({
          where: { id: row.id },
          data: {
            publishedPricePaise: saved.pricePaise,
            publishedProduct: json({
              id: p.id,
              name: p.name,
              brand: p.brand,
              specification: [p.grade, p.type, p.packSize].filter(Boolean).join(' · '),
              unit: p.unit,
              pricePaise: saved.pricePaise,
              priceVersion: saved.priceVersion,
              version: saved.version,
            }),
          },
        });
        if (row.rememberAlias) {
          const extracted = row.extracted
            ? rateExtractionSchema.shape.rows.element.parse(row.extracted)
            : null;
          const alias = extracted
            ? extractionAlias(extracted)
            : [row.brand, row.label, row.specification].filter(Boolean).join(' ');
          const normalizedAlias = normalizeAlias(alias);
          if (normalizedAlias) {
            const prior = await tx.productAlias.findUnique({ where: { normalizedAlias } });
            if (prior && prior.productId !== p.id)
              fail(
                'ALIAS_CONFLICT',
                'A remembered alias already belongs to another product. Disable remembering or correct the mapping.',
                409,
              );
            if (!prior)
              await tx.productAlias.create({
                data: { productId: p.id, alias, normalizedAlias, source: id, confirmedBy: actor },
              });
          }
        }
      }
      const stamp = new Date();
      await tx.priceUpdateBatch.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: stamp,
          publishedBy: actor,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'RATE_BATCH_PUBLISHED',
          entityId: id,
          details: {
            changed: rows
              .filter((r) => r.included && r.oldPricePaise !== r.proposedPricePaise)
              .map((r) => ({
                productId: r.productId,
                oldPricePaise: r.oldPricePaise,
                newPricePaise: r.proposedPricePaise,
              })),
            sourceId: b.sourceId,
          },
        },
      });
      return true;
    });
    if (changed) this.events.publish({ type: 'CATALOG_UPDATED' });
    return this.get(id);
  }
  async card(id: string, input: z.infer<typeof rateCardSchema>, actor: string) {
    return this.db.atomic(async (tx) => {
      const batch = await tx.priceUpdateBatch.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      });
      if (batch.status !== 'PUBLISHED')
        fail('BATCH_NOT_PUBLISHED', 'Publish reviewed prices before creating artwork.', 409);
      const selected = batch.items.filter((i) => i.included);
      for (const row of selected) {
        const snap = row.publishedProduct as { priceVersion: number } | null;
        if (
          !row.product?.active ||
          row.product.pricePaise !== row.publishedPricePaise ||
          row.product.priceVersion !== snap?.priceVersion
        )
          fail(
            'CARD_PRICES_CHANGED',
            'These prices have changed since publication. Create and review a fresh batch before making a current rate card.',
            409,
          );
      }
      const settings = await tx.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
      const snapshot = {
        heading: input.heading,
        deliveryMessage: input.deliveryMessage,
        promotionalCopy: input.promotionalCopy,
        contactLabel: input.contactLabel,
        phone: settings.phone,
        whatsapp: settings.phone,
        publishedAt: batch.publishedAt!.toISOString(),
        items: selected.map((row) => {
          const p = row.publishedProduct as {
            name: string;
            brand: string;
            specification: string;
            unit: string;
          };
          return { ...p, pricePaise: row.publishedPricePaise! };
        }),
      };
      const card = await tx.rateCard.create({
        data: {
          batchId: id,
          format: input.format,
          template: input.template,
          snapshot: json(snapshot),
          createdBy: actor,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'RATE_CARD_CREATED',
          entityId: id,
          details: { cardId: card.id, format: card.format, rows: selected.length },
        },
      });
      return card;
    });
  }
}
@Admin()
@Controller('admin/rate-studio')
export class RateStudioController {
  constructor(
    @Inject(RateStudioService) private studio: RateStudioService,
    @Inject(Db) private db: Db,
    @Inject(RateStorage) private storage: RateStorage,
  ) {}
  @Get('providers') providers() {
    return {
      visionConfigured: Boolean(process.env.GOOGLE_VISION_API_KEY),
      modelConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.RATE_OPENAI_MODEL),
      model: process.env.RATE_OPENAI_MODEL || null,
      storageConfigured:
        process.env.NODE_ENV !== 'production' || Boolean(process.env.RATE_SOURCE_BUCKET),
    };
  }
  @Get('batches') async list(@Query() query: Record<string, string>) {
    const page = paginate(query, 'rate-batches');
    const data = await this.db.priceUpdateBatch.findMany({
      where: page.after,
      orderBy: page.orderBy,
      take: page.take,
      include: { _count: { select: { items: true } }, cards: true },
    });
    return page.finish(
      data.map((b) => ({
        ...b,
        itemCount: b._count.items,
        items: [],
        source: null,
        issues: [],
        attemptToken: undefined,
        leaseUntil: undefined,
      })),
    );
  }
  @Post('batches') @Contract(rateBatchCreateSchema) create(
    @Input(rateBatchCreateSchema) b: z.infer<typeof rateBatchCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.create(b, req.user.id);
  }
  @Get('batches/:id') get(@Param('id') id: string) {
    return this.studio.get(id);
  }
  @Patch('batches/:id') @Contract(rateBatchSaveSchema) save(
    @Param('id') id: string,
    @Input(rateBatchSaveSchema) b: z.infer<typeof rateBatchSaveSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.save(id, b, req.user.id);
  }
  @Post('batches/:id/adjust') @Contract(rateAdjustmentSchema) adjust(
    @Param('id') id: string,
    @Input(rateAdjustmentSchema) b: z.infer<typeof rateAdjustmentSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.adjust(id, b, req.user.id);
  }
  @Post('batches/:id/extract') @Contract(rateVersionSchema) extract(
    @Param('id') id: string,
    @Input(rateVersionSchema) b: z.infer<typeof rateVersionSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.start(id, b.expectedVersion, req.user.id);
  }
  @Post('batches/:id/publish') @Contract(ratePublishSchema) publish(
    @Param('id') id: string,
    @Input(ratePublishSchema) b: z.infer<typeof ratePublishSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.publish(id, b.expectedVersion, req.user.id);
  }
  @Post('batches/:id/cancel') @Contract(rateVersionSchema) async cancel(
    @Param('id') id: string,
    @Input(rateVersionSchema) b: z.infer<typeof rateVersionSchema>,
    @Req() req: AuthRequest,
  ) {
    await this.db.atomic(async (tx) => {
      const batch = await tx.priceUpdateBatch.findUniqueOrThrow({ where: { id } });
      editable(batch, b.expectedVersion);
      await tx.priceUpdateBatch.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'RATE_BATCH_CANCELLED', entityId: id, details: {} },
      });
    });
    return this.studio.get(id);
  }
  @Post('batches/:id/source') source(@Param('id') id: string, @Req() req: AuthRequest) {
    const version = Number(req.headers['x-batch-version']);
    if (!Number.isSafeInteger(version) || version < 1)
      fail('INVALID_VERSION', 'Reload the saved batch before uploading.');
    let name = 'Rate sheet';
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || name));
    } catch {
      fail('INVALID_FILENAME', 'Choose the source file again.');
    }
    return this.studio.upload(
      id,
      version,
      req.body as Buffer,
      String(req.headers['content-type'] || ''),
      name,
      req.user.id,
    );
  }
  @Get('batches/:id/source') async image(@Param('id') id: string, @Res() res: Response) {
    const batch = await this.db.priceUpdateBatch.findUniqueOrThrow({
      where: { id },
      include: { source: true },
    });
    if (!batch.source) fail('NOT_FOUND', 'No source attached.', 404);
    const bytes = await this.storage.get(batch.source.storageKey);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Type', batch.source.contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.send(bytes);
  }
  @Post('batches/:id/cards') @Contract(rateCardSchema) card(
    @Param('id') id: string,
    @Input(rateCardSchema) b: z.infer<typeof rateCardSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.studio.card(id, b, req.user.id);
  }
  @Get('cards/:id') async cardInfo(@Param('id') id: string) {
    const c = await this.db.rateCard.findUniqueOrThrow({ where: { id } });
    const pages = renderRateCardPages(
      c.snapshot as unknown as CardSnapshot,
      c.format as 'STATUS',
      c.template as 'COUNTER',
    );
    return { ...c, pages: pages.length };
  }
  @Get('cards/:id/pages/:page/:format') async cardPage(
    @Param('id') id: string,
    @Param('page') page: string,
    @Param('format') format: string,
    @Res() res: Response,
  ) {
    if (!['png', 'svg'].includes(format) || !/^\d{1,3}$/.test(page))
      fail('INVALID_FORMAT', 'Choose an available card page.');
    const c = await this.db.rateCard.findUniqueOrThrow({ where: { id } });
    const pages = renderRateCardPages(
      c.snapshot as unknown as CardSnapshot,
      c.format as 'STATUS',
      c.template as 'COUNTER',
    );
    const svg = pages[Number(page) - 1];
    if (!svg) fail('NOT_FOUND', 'Rate card page not found.', 404);
    try {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      res.setHeader('Content-Type', format === 'png' ? 'image/png' : 'image/svg+xml');
      res.setHeader('Content-Disposition', `inline; filename="shiv-rates-${id}-${page}.${format}"`);
      res.send(format === 'png' ? await rateCardPng(svg) : svg);
    } catch {
      fail(
        'CARD_RENDER_FAILED',
        'Prices are published. Artwork could not render; retry or download SVG.',
        503,
      );
    }
  }
}

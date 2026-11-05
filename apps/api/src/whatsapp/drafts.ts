import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type WaDraft } from '@prisma/client';
import {
  canDo,
  waDraftConfirmSchema,
  waDraftEditSchema,
  waDraftRefuseSchema,
  waPasteSchema,
} from '@shiv/shared';
import { z } from 'zod';
import { budget } from '../abuse';
import { Events } from '../catalog';
import { loadCatalog } from '../catalog-match';
import { getConfig } from '../config';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  Input,
  requireAt,
  scoped,
  shopForAction,
  shopWhere,
} from '../http';
import { paginate } from '../pagination';
import { PhoneOrdersService } from '../phone-orders';
import { enqueueDecision } from './decisions';
import {
  alertOff,
  draftEvent,
  draftJson,
  linesOf,
  planReplies,
  type DraftLine,
} from './draft-core';
import type { ReplyLanguage } from './replies';
import { isNight } from './sender';
import { cleanWords, maskedContact, WaService } from './service';

const textLimit = 2000;
const dayMs = 86400000;
/** Unanswered by the close of the next day. A draft Papa answered never gets here (decision 7). */
export const draftExpiryMs = 2 * dayMs;
/** Decision 14: one unprompted word from the AI after about 2 shop hours. */
const nudgeAfterMs = 2 * 3600000;
const filterSchema = z.enum(['open', 'papa', 'closed']).default('open');

type Include = Prisma.WaDraftGetPayload<{
  include: { thread: { select: { aiMode: true; savedName: true; profileName: true } } };
}>;
const withThread = {
  thread: { select: { aiMode: true, savedName: true, profileName: true } },
} as const;

/**
 * What a person sees and taps. A reading only ever fills in a card. An order comes from here alone,
 * from a named person's tap, and is the only way a draft becomes CONFIRMED.
 */
@Injectable()
export class WaDrafts {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaService) private wa: WaService,
    @Inject(PhoneOrdersService) private orders: PhoneOrdersService,
    @Inject(Events) private events: Events,
  ) {}

  /** Cards with what they need around them: list rates now, who pays, who decided. */
  async views(rows: Include[], req: AuthRequest) {
    const productIds = [
      ...new Set(rows.flatMap((row) => linesOf(row).flatMap((line) => line.productId ?? []))),
    ];
    const products = await this.db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        unit: true,
        pricePaise: true,
        priceVersion: true,
        active: true,
      },
    });
    const peopleIds = [
      ...new Set(rows.flatMap((row) => [row.payerUserId, row.decidedById].filter(Boolean))),
    ] as string[];
    const people = await this.db.user.findMany({
      where: { id: { in: peopleIds } },
      select: { id: true, name: true, phone: true, creditAllowed: true },
    });
    const orderIds = rows.flatMap((row) => row.orderId ?? []);
    const orders = await this.db.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, number: true },
    });
    const decisions = await this.db.waReply.findMany({
      where: { draftId: { in: rows.map((row) => row.id) }, class: 'HUMAN_DECISION' },
      select: {
        draftId: true,
        status: true,
        skipReason: true,
        failedCode: true,
        body: true,
        sentAt: true,
      },
    });
    const seePhones = (locationId: string) => canDo(req.access, 'customers.read', locationId);
    return rows.map((row) => {
      const payer = people.find((person) => person.id === row.payerUserId);
      const by = people.find((person) => person.id === row.decidedById);
      const decision = decisions.find((reply) => reply.draftId === row.id);
      return {
        id: row.id,
        status: row.status,
        version: row.version,
        source: row.source,
        pasted: row.source === 'PASTE',
        locationId: row.locationId,
        band: row.band,
        flags: row.flags,
        words: row.originalText,
        truncated: row.truncated,
        createdAt: row.createdAt,
        lines: linesOf(row).map((line) => {
          const product = products.find((item) => item.id === line.productId);
          return {
            ...line,
            unit: product?.unit ?? null,
            active: product?.active ?? false,
            // The shop's list rate, shown so a person sees what the order will start from.
            listPricePaise: product?.pricePaise ?? null,
            priceVersion: product?.priceVersion ?? null,
          };
        }),
        placeText: row.placeText,
        pincode: row.pincode,
        fulfilment: row.fulfilment,
        dayKind: row.dayKind,
        deliveryDate: row.deliveryDate,
        timeWish: row.timeWish,
        orderedBy: {
          // The saved name first. What the sender calls themselves is labelled as just that.
          name: row.orderedByName,
          profileName: row.thread?.profileName ?? '',
          masked: maskedContact(row.orderedByPhone),
          phone: seePhones(row.locationId) ? row.orderedByPhone : null,
        },
        payWhen: row.payWhen,
        payer: payer
          ? {
              id: payer.id,
              name: payer.name,
              masked: maskedContact(payer.phone),
              creditAllowed: payer.creditAllowed,
            }
          : null,
        payerWords: row.payerWords,
        paymentWords: row.paymentWords,
        papaRepliedAt: row.papaRepliedAt,
        aiOff: Boolean(row.thread && row.thread.aiMode !== 'AUTO'),
        readerError: row.readerError,
        decided: row.decidedAt
          ? {
              byName: by?.name ?? '',
              at: row.decidedAt,
              reason: row.refuseReason,
              orderId: row.orderId,
              orderNumber: orders.find((order) => order.id === row.orderId)?.number ?? null,
            }
          : null,
        message: decision
          ? {
              status: decision.status,
              reason: decision.skipReason ?? decision.failedCode,
              words: decision.status === 'SENT' ? null : decision.body,
            }
          : null,
      };
    });
  }

  async list(query: Record<string, string>, req: AuthRequest) {
    const parsed = filterSchema.safeParse(query.filter);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filter.');
    const filter = parsed.data;
    const page = paginate(query, `wa-drafts:${filter}`);
    const where: Prisma.WaDraftWhereInput =
      filter === 'closed'
        ? { status: { not: 'OPEN' } }
        : filter === 'papa'
          ? { status: 'OPEN', papaRepliedAt: { not: null } }
          : { status: 'OPEN', papaRepliedAt: null };
    const rows = await this.db.waDraft.findMany({
      where: { ...where, ...shopWhere(req, 'wa.cards'), ...page.after },
      include: withThread,
      orderBy: page.orderBy,
      take: page.take,
    });
    return page.finish(await this.views(rows, req));
  }

  async one(id: string, req: AuthRequest) {
    const row = await this.db.waDraft.findUnique({ where: { id }, include: withThread });
    if (!row) fail('WA_DRAFT_NOT_FOUND', 'That card is not here.', 404);
    requireAt(req, 'wa.cards', row.locationId);
    return (await this.views([row], req))[0]!;
  }

  /** Anything that arrives another way goes through the same reader and rules, onto the same card. */
  async paste(body: z.infer<typeof waPasteSchema>, req: AuthRequest) {
    const c = getConfig();
    const locationId = shopForAction(req, 'wa.cards', body.locationId);
    const replay = await this.pasted(body.idempotencyKey, req);
    if (replay) return replay;
    if (!(await this.db.location.findFirst({ where: { id: locationId, active: true } })))
      fail('INVALID_SHOP', 'That shop is not here.', 404);
    await this.db.atomic((tx) =>
      budget(tx, 'wa-paste', req.user.id, c.WA_PASTES_PER_HOUR, 3600_000),
    );
    const clean = cleanWords(body.text).trim();
    if (!clean) fail('INVALID_BODY', 'There are no words here to read.');
    const truncated = clean.length > textLimit;
    const words = cleanWords(clean.slice(0, textLimit));
    const settings = await this.wa.settings();
    const thread = body.phone
      ? await this.db.waThread.findUnique({ where: { phone: body.phone } })
      : null;
    // Words pasted about a number marked off, or while the AI is stopped, reach no reader at all.
    const aiOff = settings.aiPaused || Boolean(thread && thread.aiMode !== 'AUTO');
    const catalog = await loadCatalog(this.db);
    const whole = aiOff
      ? null
      : await this.wa.readText(words, {
          catalog,
          sentAt: new Date(),
          truncated,
          known: Boolean(thread?.userId),
          humanQuiet: false,
          subject: `paste:${req.user.id}`,
        });
    const reading = whole?.reading ?? null;
    const usable =
      reading &&
      reading.band !== 'RED' &&
      (reading.intent === 'ORDER' || reading.intent === 'ORDER_CHANGE');
    const flags = [
      ...new Set([
        ...(reading?.flags ?? []),
        ...(aiOff ? ['AI_OFF'] : []),
        ...(whole?.errorCode ? ['NO_READING'] : []),
      ]),
    ];
    const lines: DraftLine[] = usable
      ? reading.lines.map((line) => ({
          rawText: line.rawText,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          unitWord: line.unitWord,
          candidates: line.candidates,
        }))
      : [];
    try {
      const draft = await this.db.atomic(async (tx) => {
        const row = await tx.waDraft.create({
          data: {
            source: 'PASTE',
            locationId,
            createdById: req.user.id,
            pasteKey: body.idempotencyKey,
            orderedByName: body.name ?? thread?.savedName ?? '',
            orderedByPhone: body.phone ?? null,
            originalText: words,
            truncated,
            lines: draftJson(lines),
            placeText: usable ? reading.placeText : '',
            fulfilment: usable ? reading.fulfilment : 'UNKNOWN',
            dayKind: usable ? reading.dayKind : 'UNSPECIFIED',
            deliveryDate: usable ? reading.deliveryDate : null,
            timeWish: usable ? reading.timeWish : '',
            payerWords: reading?.forWhom ?? '',
            paymentWords: reading?.paymentWords ?? '',
            band: usable ? reading.band : 'RED',
            flags,
            reader: whole?.answer.reader ?? 'none',
            readerError: whole?.errorCode ?? null,
          },
          include: withThread,
        });
        await draftEvent(tx, row, req.user.id, 'PASTED', lines);
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'WA_DRAFT_PASTED',
            entityId: row.id,
            locationId,
            details: { length: clean.length, truncated, aiOff },
          },
        });
        return row;
      });
      return (await this.views([draft], req))[0]!;
    } catch (error) {
      // The same tap twice at once: the first one made the card.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.pasted(body.idempotencyKey, req);
        if (again) return again;
      }
      throw error;
    }
  }
  private async pasted(key: string, req: AuthRequest) {
    const row = await this.db.waDraft.findUnique({
      where: { pasteKey: key },
      include: withThread,
    });
    if (!row) return null;
    // A key is one person's. Guessing another's must not open their card.
    if (row.createdById !== req.user.id)
      fail('IDEMPOTENCY_CONFLICT', 'This key was already used.', 409);
    return (await this.views([row], req))[0]!;
  }

  /** A person fixing up a card. No price can be set here, and a stale view is refused. */
  async edit(id: string, body: z.infer<typeof waDraftEditSchema>, req: AuthRequest) {
    const updated = await this.db.atomic(async (tx) => {
      const seen = await tx.waDraft.findUnique({ where: { id } });
      if (!seen) fail('WA_DRAFT_NOT_FOUND', 'That card is not here.', 404);
      // Whose it is first, so someone from another shop learns nothing about its state.
      requireAt(req, 'wa.cards', seen.locationId);
      const draft = await this.openFor(tx, id, body.expectedVersion);
      const data: Prisma.WaDraftUpdateInput = {
        version: { increment: 1 },
        flags: [...new Set([...draft.flags, 'EDITED_BY_PERSON'])],
      };
      let lines: DraftLine[] | undefined;
      if (body.lines) {
        lines = await this.linesFromPerson(tx, body.lines, linesOf(draft));
        data.lines = draftJson(lines);
      }
      if (body.placeText !== undefined) data.placeText = cleanWords(body.placeText).trim();
      if (body.pincode !== undefined) data.pincode = body.pincode;
      if (body.fulfilment !== undefined) data.fulfilment = body.fulfilment;
      if (body.deliveryDate !== undefined) {
        data.deliveryDate = body.deliveryDate;
        data.dayKind = body.deliveryDate ? 'DATE' : 'UNSPECIFIED';
      }
      if (body.orderedByName !== undefined)
        data.orderedByName = cleanWords(body.orderedByName).trim();
      if (body.orderedByPhone !== undefined) data.orderedByPhone = body.orderedByPhone;
      if (body.payWhen !== undefined) data.payWhen = body.payWhen;
      if (body.payerPhone !== undefined) {
        if (body.payerPhone === null) data.payerUserId = null;
        else {
          const payer = await tx.user.findFirst({
            where: { phone: body.payerPhone, role: 'CUSTOMER', deletedAt: null },
            select: { id: true },
          });
          if (!payer) fail('NOT_FOUND', 'No customer has that number.', 404);
          data.payerUserId = payer.id;
        }
      }
      const row = await tx.waDraft.update({ where: { id }, data, include: withThread });
      await draftEvent(tx, row, req.user.id, 'EDITED', lines);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_DRAFT_EDITED',
          entityId: id,
          locationId: draft.locationId,
          details: { version: row.version },
        },
      });
      return row;
    });
    return (await this.views([updated], req))[0]!;
  }
  /** Sizes come from the family's list and the sum happens here, never from a model's guess. */
  private async linesFromPerson(
    tx: Prisma.TransactionClient,
    asked: NonNullable<z.infer<typeof waDraftEditSchema>['lines']>,
    before: DraftLine[],
  ) {
    const lines: DraftLine[] = [];
    for (const line of asked) {
      const product = line.productId
        ? await tx.product.findFirst({
            where: { id: line.productId, active: true },
            select: { id: true, name: true },
          })
        : null;
      if (line.productId && !product) fail('NOT_FOUND', 'That product is not on the list.', 404);
      let quantity = line.quantity;
      if (line.loadSizeId) {
        const size = await tx.waLoadSize.findFirst({
          where: { id: line.loadSizeId, active: true, productId: line.productId ?? '' },
        });
        if (!size) fail('WA_LOAD_SIZE_NOT_FOUND', 'That size is not on the family list.', 404);
        quantity = size.quantity * (line.loadCount ?? 1);
      }
      if (quantity !== null && quantity > 10000)
        fail('INVALID_BODY', 'That is more than one order can hold.');
      const was = before.find((row) => row.productId && row.productId === line.productId);
      lines.push({
        rawText: cleanWords(line.rawText ?? was?.rawText ?? '').trim(),
        productId: line.productId,
        productName: product?.name ?? null,
        quantity,
        unitWord: line.unitWord ?? was?.unitWord ?? null,
        candidates: product ? 1 : 0,
        loadSizeId: line.loadSizeId ?? null,
        loadCount: line.loadSizeId ? (line.loadCount ?? 1) : null,
      });
    }
    return lines;
  }
  private async openFor(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    const draft = await tx.waDraft.findUnique({ where: { id } });
    if (!draft) fail('WA_DRAFT_NOT_FOUND', 'That card is not here.', 404);
    if (draft.status !== 'OPEN')
      fail('WA_DRAFT_CLOSED', 'This card has already been dealt with.', 409);
    if (draft.version !== expectedVersion)
      fail('WA_DRAFT_CHANGED', 'This card changed. Look at it again.', 409);
    return draft;
  }

  /**
   * The only way a draft becomes an order: a person's tap, all in one transaction. The second of
   * two tappers is told who got there first. It is not an error.
   */
  async confirm(id: string, body: z.infer<typeof waDraftConfirmSchema>, req: AuthRequest) {
    const result = await this.db.atomic(async (tx) => {
      const seen = await tx.waDraft.findUnique({ where: { id } });
      if (!seen) fail('WA_DRAFT_NOT_FOUND', 'That card is not here.', 404);
      requireAt(req, 'orders.confirm', seen.locationId);
      if (seen.status === 'CONFIRMED') return this.alreadyDone(tx, seen);
      const draft = await this.openFor(tx, id, body.expectedVersion);
      const { items, customerPhone, paymentMethod, deliveryDate, address, notes } =
        await this.orderFacts(tx, draft);
      if (paymentMethod === 'CREDIT') requireAt(req, 'orders.confirm.credit', draft.locationId);
      // A rate that moved since the card was drawn is a different order from the one they tapped.
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { priceVersion: true },
        });
        if (product?.priceVersion !== body.priceVersions[item.productId])
          fail('WA_DRAFT_RATE_MOVED', 'A rate changed. Look at the card again.', 409);
      }
      const order = await this.orders.createIn(
        tx,
        {
          customerPhone,
          ...(draft.orderedByName && !draft.payerUserId
            ? { customerName: draft.orderedByName }
            : {}),
          source: 'WHATSAPP',
          items,
          ...(address ? { address } : {}),
          deliveryDate,
          paymentMethod,
          notes,
          idempotencyKey: `wa:${draft.id}`,
          overrideLimit: false,
        },
        req.user.id,
        draft.locationId,
      );
      const decidedAt = new Date();
      await tx.waDraft.update({
        where: { id },
        data: { status: 'CONFIRMED', orderId: order.id, decidedById: req.user.id, decidedAt },
      });
      await draftEvent(
        tx,
        { id, version: draft.version },
        req.user.id,
        'CONFIRMED',
        linesOf(draft),
      );
      await alertOff(tx, id);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_DRAFT_CONFIRMED',
          entityId: id,
          locationId: draft.locationId,
          details: { orderId: order.id, version: draft.version },
        },
      });
      if (draft.threadId) {
        const thread = await tx.waThread.findUniqueOrThrow({ where: { id: draft.threadId } });
        await enqueueDecision(tx, {
          actorId: req.user.id,
          threadId: draft.threadId,
          draftId: id,
          language: thread.language as ReplyLanguage,
          facts: {
            kind: draft.flags.includes('EDITED_BY_PERSON') ? 'CONFIRMED_CHANGED' : 'CONFIRMED',
            number: order.number,
            // Said from the order itself: nothing of the customer's own words is repeated back.
            lines: order.items
              .map((item) => `${item.quantity} ${item.unit} ${item.name}`)
              .join(', '),
            totalPaise: order.totalPaise,
            day: order.deliveryDate,
          },
        });
      }
      return { ok: true, already: false, orderId: order.id, number: order.number };
    });
    if (!result.already) this.events.publish({ type: 'CATALOG_UPDATED' });
    return result;
  }
  private async alreadyDone(tx: Prisma.TransactionClient, draft: WaDraft) {
    const [person, order] = await Promise.all([
      tx.user.findUnique({ where: { id: draft.decidedById! }, select: { name: true } }),
      tx.order.findUnique({ where: { id: draft.orderId! }, select: { number: true } }),
    ]);
    return {
      ok: true,
      already: true,
      orderId: draft.orderId!,
      number: order?.number ?? '',
      byName: person?.name ?? '',
      at: draft.decidedAt!,
    };
  }
  /** Who ordered, who pays and where to: all of it a person's call on the card. */
  private async orderFacts(tx: Prisma.TransactionClient, draft: WaDraft) {
    const incomplete = (message: string) => fail('WA_DRAFT_INCOMPLETE', message, 409);
    const lines = linesOf(draft);
    if (!lines.length) incomplete('Add what they want first.');
    const items = lines.map((line) => {
      if (!line.productId || !line.quantity)
        incomplete('Each line needs a product and a quantity.');
      return { productId: line.productId!, quantity: line.quantity! };
    });
    if (new Set(items.map((item) => item.productId)).size !== items.length)
      incomplete('Each product can appear once.');
    if (!draft.deliveryDate) incomplete('Choose the day.');
    const payer = draft.payerUserId
      ? await tx.user.findFirst({
          where: { id: draft.payerUserId, deletedAt: null },
          select: { phone: true, name: true },
        })
      : null;
    if (draft.payerUserId && !payer) incomplete('Choose who pays again.');
    // Udhaar goes on a customer a person named. An AI's words about whose account never reach this.
    if (draft.payWhen === 'UDHAAR' && !payer) incomplete('Choose whose udhaar this goes on.');
    const customerPhone = payer?.phone ?? draft.orderedByPhone;
    if (!customerPhone) incomplete('This needs a phone number.');
    const delivering = draft.fulfilment === 'DELIVERY';
    if (draft.fulfilment === 'UNKNOWN') incomplete('Choose delivery or pickup.');
    if (delivering && !draft.pincode) incomplete('Add the pincode for delivery.');
    const who = draft.orderedByName || maskedContact(draft.orderedByPhone);
    const name = payer?.name || draft.orderedByName || who;
    const place = draft.placeText || 'WhatsApp order';
    return {
      items,
      customerPhone: customerPhone!,
      paymentMethod: draft.payWhen === 'UDHAAR' ? ('CREDIT' as const) : ('COD' as const),
      deliveryDate: draft.deliveryDate!,
      address: delivering
        ? {
            label: 'WhatsApp',
            name,
            phone: customerPhone!,
            line1: place,
            area: place,
            city: 'Patna',
            state: 'Bihar' as const,
            pincode: draft.pincode!,
            landmark: '',
          }
        : undefined,
      // Built here from the card's own fields, so no customer's words reach the order.
      notes: [
        `${draft.source === 'PASTE' ? 'Paste box' : 'WhatsApp'}, bheja: ${who}`,
        draft.payWhen === 'PAID_NOW' ? 'Paisa: abhi mila' : '',
        draft.payWhen === 'AT_DELIVERY' ? 'Paisa: delivery par' : '',
      ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 500),
    };
  }

  /** A person's refusal. Only that reason reaches the customer, in the shop's words. */
  async refuse(id: string, body: z.infer<typeof waDraftRefuseSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const seen = await tx.waDraft.findUnique({ where: { id } });
      if (!seen) fail('WA_DRAFT_NOT_FOUND', 'That card is not here.', 404);
      requireAt(req, 'orders.confirm', seen.locationId);
      const draft = await this.openFor(tx, id, body.expectedVersion);
      await tx.waDraft.update({
        where: { id },
        data: {
          status: 'REFUSED',
          decidedById: req.user.id,
          decidedAt: new Date(),
          refuseReason: body.reason,
        },
      });
      await draftEvent(tx, { id, version: draft.version }, req.user.id, 'REFUSED');
      await alertOff(tx, id);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_DRAFT_REFUSED',
          entityId: id,
          locationId: draft.locationId,
          details: { reason: body.reason },
        },
      });
      if (draft.threadId) {
        const thread = await tx.waThread.findUniqueOrThrow({ where: { id: draft.threadId } });
        await enqueueDecision(tx, {
          actorId: req.user.id,
          threadId: draft.threadId,
          draftId: id,
          language: thread.language as ReplyLanguage,
          facts: { kind: 'REFUSED', reason: body.reason, note: body.note },
        });
      }
      return { ok: true };
    });
  }

  /**
   * Draft timers, run by the worker. Decision 14's holidays are not counted yet: nothing holds the
   * shop's days and hours until the family gives them, so this counts days and the night setting.
   */
  async timers() {
    const now = new Date();
    const old = await this.db.waDraft.findMany({
      where: {
        status: 'OPEN',
        papaRepliedAt: null,
        createdAt: { lt: new Date(now.getTime() - draftExpiryMs) },
      },
      select: { id: true, version: true },
      take: 200,
    });
    for (const { id, version } of old)
      await this.db.atomic(async (tx) => {
        const moved = await tx.waDraft.updateMany({
          where: { id, status: 'OPEN', papaRepliedAt: null },
          data: { status: 'EXPIRED' },
        });
        if (!moved.count) return;
        await draftEvent(tx, { id, version }, 'system', 'EXPIRED');
        await alertOff(tx, id);
      });
    await this.nudge(now);
  }
  /** "The shop is looking at it", once, if nobody has tapped after about 2 hours. */
  private async nudge(now: Date) {
    const c = getConfig();
    const settings = await this.wa.settings();
    if (c.WA_MODE !== 'reply' || settings.replyStage === 'OFF' || settings.aiPaused) return;
    if (isNight(now, settings.nightFromHour, settings.nightToHour)) return;
    const waiting = await this.db.waDraft.findMany({
      where: {
        status: 'OPEN',
        source: 'WHATSAPP',
        papaRepliedAt: null,
        lastWaitingAt: null,
        band: { not: 'RED' },
        createdAt: {
          lt: new Date(now.getTime() - nudgeAfterMs),
          gte: new Date(now.getTime() - draftExpiryMs),
        },
      },
      include: { thread: true },
      take: 50,
    });
    if (!waiting.length) return;
    const catalog = await loadCatalog(this.db);
    for (const draft of waiting) {
      if (!draft.thread) continue;
      await this.db.atomic(async (tx) => {
        const moved = await tx.waDraft.updateMany({
          where: { id: draft.id, status: 'OPEN', lastWaitingAt: null },
          data: { lastWaitingAt: now },
        });
        if (!moved.count) return;
        await planReplies(tx, {
          thread: draft.thread!,
          settings,
          kinds: ['WAITING'],
          runId: null,
          triggerAt: null,
          draft,
          language: draft.thread!.language as ReplyLanguage,
          catalog,
          reading: null,
          quietReceipt: false,
        });
      });
    }
  }
}

@ApiTags('WhatsApp')
@Controller('admin/wa')
export class WaCardsController {
  constructor(@Inject(WaDrafts) private drafts: WaDrafts) {}

  @Can('wa.cards', scoped) @Get('drafts') list(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.drafts.list(query, req);
  }

  @Can('wa.cards', scoped) @Get('drafts/:id') one(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.drafts.one(id, req);
  }

  @Can('wa.cards', scoped)
  @Patch('drafts/:id')
  @Contract(waDraftEditSchema)
  edit(
    @Param('id') id: string,
    @Input(waDraftEditSchema) body: z.infer<typeof waDraftEditSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.drafts.edit(id, body, req);
  }

  /** "Order banao" and "Pakka karo": a named person, with the right to confirm at that shop. */
  @Can('orders.confirm', scoped)
  @HttpCode(200)
  @Post('drafts/:id/confirm')
  @Contract(waDraftConfirmSchema)
  confirm(
    @Param('id') id: string,
    @Input(waDraftConfirmSchema) body: z.infer<typeof waDraftConfirmSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.drafts.confirm(id, body, req);
  }

  @Can('orders.confirm', scoped)
  @HttpCode(200)
  @Post('drafts/:id/refuse')
  @Contract(waDraftRefuseSchema)
  refuse(
    @Param('id') id: string,
    @Input(waDraftRefuseSchema) body: z.infer<typeof waDraftRefuseSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.drafts.refuse(id, body, req);
  }

  /** Works with WhatsApp not connected at all. It never sends anything to anyone. */
  @Can('wa.cards', scoped)
  @Post('paste')
  @Contract(waPasteSchema)
  paste(@Input(waPasteSchema) body: z.infer<typeof waPasteSchema>, @Req() req: AuthRequest) {
    return this.drafts.paste(body, req);
  }
}

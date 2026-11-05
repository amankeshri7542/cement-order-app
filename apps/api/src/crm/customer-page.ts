import { Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  canDo,
  istToday,
  quietText,
  reminderBlock,
  reminderPurposes,
  reminderSchema,
  reminderStopSchema,
  reminderText,
  whatsappLink,
  type ReminderBlock,
  type ReminderPurpose,
} from '@shiv/shared';
import { z } from 'zod';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  forbid,
  Input,
  requireAt,
  scoped,
  shopWhere,
} from '../http';
import { paginate } from '../pagination';
import { activeRules, priceFor } from '../price-rules';
import {
  balanceShops,
  dayStart,
  oldestDues,
  phoneFields,
  realCustomer,
  SHOP_NAME,
  stoppedIds,
  type Tx,
} from './common';
import { TallyNumbers } from './tally-numbers';

const blockCode: Record<ReminderBlock, [code: string, message: string]> = {
  NO_PHONE: ['REMINDER_NO_PHONE', 'There is no mobile number to send this to.'],
  STOPPED: ['REMINDER_STOPPED', 'This customer asked not to be sent reminders.'],
  NOT_SIGNED: ['REMINDER_NOT_SIGNED', 'This customer’s opening balance is not signed off yet.'],
  NO_BALANCE: ['REMINDER_NO_BALANCE', 'Nothing is due from this customer.'],
};
const notStaff = { deletedAt: null, role: { not: 'ADMIN' as const } };

@ApiTags('Customer khata and CRM')
@Controller('admin')
export class CustomerPageController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyNumbers) private tally: TallyNumbers,
  ) {}

  /**
   * Sab kuch: orders, money, reminders, calls, notes and follow-ups, newest first. Each source is
   * read past the cursor and the pages merged, so there is no table to keep in step. A shop's
   * people see that shop's orders and calls; the balance and the notes belong to the whole firm.
   */
  @Can('customers.read')
  @Get('customers/:id/timeline')
  async timeline(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    const page = paginate(query, `timeline:${id}`);
    const customer = await this.db.user.findFirst({
      where: { id, ...notStaff },
      select: { id: true },
    });
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    // paginate has already checked this cursor and its date.
    const after = query.cursor
      ? (JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as {
          value: string;
          id: string;
        })
      : null;
    const before = (field: string) => {
      if (!after) return {};
      const at = new Date(after.value);
      return { OR: [{ [field]: { lt: at } }, { [field]: at, id: { lt: after.id } }] };
    };
    const order = (field: string) => [{ [field]: 'desc' as const }, { id: 'desc' as const }];
    const can = (permission: Parameters<typeof canDo>[1], shop?: string) =>
      canDo(req.access, permission, shop);
    const nothing = Promise.resolve([] as never[]);
    const [orders, entries, notes, contacts, followUps] = await Promise.all([
      can('orders.read')
        ? this.db.order.findMany({
            where: { userId: id, ...shopWhere(req, 'orders.read'), ...before('createdAt') },
            orderBy: order('createdAt'),
            take: page.take,
            select: {
              id: true,
              number: true,
              status: true,
              source: true,
              totalPaise: true,
              createdAt: true,
              createdById: true,
              locationId: true,
              address: true,
              location: { select: { name: true } },
              items: { select: { name: true }, take: 1, orderBy: { id: 'asc' } },
              _count: { select: { items: true } },
            },
          })
        : nothing,
      can('khata.read.one')
        ? this.db.customerLedgerEntry.findMany({
            where: { customerId: id, ...before('occurredAt') },
            orderBy: order('occurredAt'),
            take: page.take,
            select: {
              id: true,
              kind: true,
              amountPaise: true,
              balanceAfterPaise: true,
              note: true,
              actorId: true,
              occurredAt: true,
              location: { select: { name: true } },
              reversesId: true,
              reversal: { select: { id: true } },
              order: { select: { id: true, number: true, locationId: true } },
              reverses: { select: { order: { select: { locationId: true } } } },
              financialMovement: { select: { channel: true } },
            },
          })
        : nothing,
      this.db.customerNote.findMany({
        where: { customerId: id, ...before('createdAt') },
        orderBy: order('createdAt'),
        take: page.take,
      }),
      this.db.customerContact.findMany({
        where: { customerId: id, ...before('createdAt') },
        orderBy: order('createdAt'),
        take: page.take,
      }),
      can('crm.followups.read')
        ? this.db.followUp.findMany({
            where: {
              customerId: id,
              ...shopWhere(req, 'crm.followups.read'),
              ...before('createdAt'),
            },
            orderBy: order('createdAt'),
            take: page.take,
            include: {
              assignee: { select: { id: true, name: true } },
              location: { select: { name: true } },
              events: {
                where: { action: 'SNOOZED' },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { reason: true },
              },
            },
          })
        : nothing,
    ]);
    const merged = [
      ...orders.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actorId: row.createdById,
        kind: 'ORDER' as const,
        number: row.number,
        status: row.status,
        source: row.source,
        totalPaise: can('orders.read.money', row.locationId) ? row.totalPaise : null,
        shopName: row.location.name,
        site: ((row.address as { area?: string } | null)?.area ?? '') as string,
        firstItem: row.items[0]?.name ?? '',
        itemCount: row._count.items,
      })),
      ...entries.map((row) => ({
        id: row.id,
        createdAt: row.occurredAt,
        actorId: row.actorId,
        kind: 'KHATA' as const,
        entryKind: row.kind,
        amountPaise: row.amountPaise,
        balanceAfterPaise: row.balanceAfterPaise,
        // An order's entry names the order in its note, and so does taking it back, so that stays
        // with the shop as well.
        note:
          (row.order ?? row.reverses?.order) &&
          !can('orders.read', (row.order ?? row.reverses!.order)!.locationId)
            ? ''
            : row.note,
        channel: row.financialMovement?.channel ?? '',
        shopName: row.location.name,
        reversed: !!row.reversal,
        isReversal: !!row.reversesId,
        // The sale is on the customer's one account; which order it was stays with that shop.
        orderNumber:
          row.order && can('orders.read', row.order.locationId) ? row.order.number : null,
      })),
      ...notes.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actorId: row.actorId,
        kind: 'NOTE' as const,
        body: row.body,
      })),
      ...contacts.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actorId: row.actorId,
        kind: 'CONTACT' as const,
        contactKind: row.kind,
        channel: row.channel,
        purpose: row.purpose,
      })),
      ...followUps.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actorId: row.createdById,
        kind: 'FOLLOWUP' as const,
        followUpKind: row.kind,
        dueOn: row.dueOn,
        note: row.note,
        promisedPaise: row.promisedPaise,
        assignee: row.assignee,
        shopName: row.location.name,
        snoozes: row.snoozes,
        lastSnoozeReason: row.events[0]?.reason ?? null,
        doneAt: row.doneAt,
      })),
    ].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    const result = page.finish(merged);
    const people = await this.db.user.findMany({
      where: {
        id: { in: [...new Set(result.items.flatMap((row) => row.actorId ?? []))] },
        role: 'ADMIN',
      },
      select: { id: true, name: true },
    });
    return {
      ...result,
      items: result.items.map(({ actorId, createdAt, ...row }) => ({
        ...row,
        at: createdAt,
        // Not someone on the staff means the customer did it themselves, or a machine did.
        actorName: people.find((person) => person.id === actorId)?.name ?? null,
      })),
    };
  }

  /** The top of the customer page. Each block only for whoever may see it. */
  @Can('customers.read')
  @Get('customers/:id/crm')
  async facts(@Param('id') id: string, @Req() req: AuthRequest) {
    const customer = await this.db.user.findFirst({
      where: { id, ...notStaff },
      select: {
        id: true,
        phone: true,
        khataBalancePaise: true,
        creditAllowed: true,
        creditLimitPaise: true,
        khataViewOn: true,
        remindersStoppedAt: true,
      },
    });
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    const seesKhata = canDo(req.access, 'khata.read.one');
    const seesOrders = canDo(req.access, 'orders.read');
    const seesCalls = canDo(req.access, 'crm.followups.read');
    const [signoff, lastOrder, lastPayment, nextFollowUp, lastReminder, oldest, stopped] =
      await Promise.all([
        this.db.khataSignoff.findFirst({ where: { customerId: id } }),
        seesOrders
          ? this.db.order.findFirst({
              where: { userId: id, ...shopWhere(req, 'orders.read') },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { id: true, number: true, createdAt: true, status: true },
            })
          : null,
        seesKhata
          ? this.db.customerLedgerEntry.findFirst({
              where: { customerId: id, kind: 'PAYMENT_RECEIVED', reversal: null },
              orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
              select: { occurredAt: true, amountPaise: true },
            })
          : null,
        seesCalls
          ? this.db.followUp.findFirst({
              where: { customerId: id, doneAt: null, ...shopWhere(req, 'crm.followups.read') },
              orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
              select: { id: true, dueOn: true, kind: true, promisedPaise: true },
            })
          : null,
        this.db.customerContact.findFirst({
          where: { customerId: id, kind: 'REMINDER' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true },
        }),
        seesKhata ? oldestDues(this.db, [id]) : null,
        stoppedIds(this.db, [customer]),
      ]);
    const approver = signoff
      ? await this.db.user.findUnique({
          where: { id: signoff.approvedById },
          select: { name: true },
        })
      : null;
    const seesTally = canDo(req.access, 'tally.numbers.view');
    return {
      signoff: signoff
        ? {
            signed: true as const,
            asOf: signoff.asOf,
            at: signoff.createdAt,
            approvedBy: approver?.name ?? '',
            ...(seesKhata ? { chosenPaise: signoff.chosenPaise } : {}),
          }
        : { signed: false as const },
      khataViewOn: customer.khataViewOn,
      reminders: { stopped: stopped.has(id), lastAt: lastReminder?.createdAt ?? null },
      lastOrder,
      lastPayment: lastPayment && {
        at: lastPayment.occurredAt,
        amountPaise: -lastPayment.amountPaise,
      },
      nextFollowUp,
      khata: seesKhata
        ? {
            balancePaise: customer.khataBalancePaise,
            creditAllowed: customer.creditAllowed,
            limitPaise: customer.creditLimitPaise,
            oldestDue: oldest?.get(id) ?? null,
          }
        : null,
      // Not even an empty block for anyone who may not see Tally: the word stays off their screen.
      ...(seesTally
        ? {
            tally: {
              connected: await this.tally.connected(),
              number: await this.tally.forCustomer(id),
            },
          }
        : {}),
    };
  }

  /** Decision 48: this customer's group, their own rates, and where they pay under the list. */
  @Can('rates.read')
  @Get('customers/:id/rates')
  async rates(@Param('id') id: string) {
    const customer = await this.db.user.findFirst({
      where: { id, ...notStaff },
      select: {
        id: true,
        customerGroupId: true,
        customerGroup: { select: { id: true, name: true, active: true } },
      },
    });
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    const [products, rules] = await Promise.all([
      this.db.product.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          unit: true,
          categoryId: true,
          pricePaise: true,
          minQuantity: true,
          category: { select: { name: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      activeRules(this.db),
    ]);
    const today = istToday();
    const own = rules.filter(
      (rule) =>
        (rule.kind === 'SPECIAL' && rule.customerId === id) ||
        (rule.kind === 'GROUP' &&
          !!customer.customerGroupId &&
          rule.groupId === customer.customerGroupId),
    );
    const named = (rule: (typeof rules)[number]) => {
      const product = products.find((row) => row.id === rule.productId);
      const category = products.find((row) => row.categoryId === rule.categoryId)?.category;
      return product?.name ?? category?.name ?? null;
    };
    return {
      group: customer.customerGroup,
      rules: own.map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        appliesTo: named(rule),
        valueType: rule.valueType,
        value: rule.value,
        minQuantity: rule.minQuantity,
        startsOn: rule.startsOn,
        endsOn: rule.endsOn,
        started: !rule.startsOn || rule.startsOn <= today,
      })),
      // The rate today at the smallest quantity sold. Slabs and offers may take it lower on a big order.
      lines: products
        .map((product) => {
          const priced = priceFor(
            product,
            product.minQuantity,
            id,
            customer.customerGroupId,
            rules,
          );
          return {
            productId: product.id,
            name: product.name,
            unit: product.unit,
            listPaise: product.pricePaise,
            ratePaise: priced.pricePaise,
            ruleKind: priced.ruleKind,
          };
        })
        .filter((line) => line.ratePaise < line.listPaise),
    };
  }

  /** The shop whose call this is: the follow-up's, or where the money or the last order is. */
  private async shopOf(
    tx: Pick<Tx, '$queryRaw' | 'followUp' | 'order'>,
    customerId: string,
    purpose: ReminderPurpose,
    followUpId?: string,
  ) {
    if (followUpId) {
      const row = await tx.followUp.findFirst({
        where: { id: followUpId, customerId },
        select: { locationId: true },
      });
      if (!row) fail('FOLLOWUP_NOT_FOUND', 'That call is not on the list.', 404);
      return row.locationId;
    }
    if (purpose === 'PAYMENT')
      return (await balanceShops(tx as never, [customerId])).get(customerId) ?? null;
    const last = await tx.order.findFirst({
      where: { userId: customerId, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { locationId: true },
    });
    return last?.locationId ?? null;
  }

  private mayRemind(req: AuthRequest, shop: string | null) {
    if (!canDo(req.access, 'customers.phone.read')) return false;
    if (shop) return canDo(req.access, 'crm.remind', shop);
    return req.access['crm.remind'] === 'ALL';
  }

  private words(purpose: ReminderPurpose, customer: { name: string; khataBalancePaise: number }) {
    return purpose === 'QUIET'
      ? quietText({ name: customer.name, shop: SHOP_NAME })
      : reminderText({
          name: customer.name,
          balancePaise: customer.khataBalancePaise,
          shop: SHOP_NAME,
        });
  }

  /**
   * What the Yaad dilao button would do, for drawing it. Sends nothing and records nothing. The link
   * holds the number, so it comes only to someone who may hold the number and work this shop.
   */
  @Can('customers.read')
  @Get('customers/:id/reminder')
  async preview(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
  ) {
    const parsed = z
      .object({ purpose: z.enum(reminderPurposes).default('PAYMENT') })
      .safeParse({ purpose: query.purpose });
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filters.');
    const { purpose } = parsed.data;
    const customer = await this.db.user.findFirst({
      where: { id, ...realCustomer },
      include: { khataSignoffs: { select: { id: true }, take: 1 } },
    });
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    const shop = await this.shopOf(this.db, id, purpose);
    const blocked = reminderBlock({
      purpose,
      stopped: (await stoppedIds(this.db, [customer])).has(id),
      signed: customer.khataSignoffs.length > 0,
      balancePaise: customer.khataBalancePaise,
      phone: customer.phone,
    });
    const seesBalance = purpose === 'QUIET' || canDo(req.access, 'khata.read.one');
    const allowed = !blocked && this.mayRemind(req, shop);
    const text = !blocked && seesBalance ? this.words(purpose, customer) : null;
    const last = await this.db.customerContact.findFirst({
      where: { customerId: id, kind: purpose === 'QUIET' ? 'QUIET' : 'REMINDER' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    const number = canDo(req.access, 'tally.numbers.view')
      ? await this.tally.forCustomer(id)
      : null;
    return {
      purpose,
      blocked,
      allowed,
      text,
      url: allowed && text ? whatsappLink(customer.phone, text) : null,
      ...phoneFields(req, customer.phone),
      lastRemindedAt: last?.createdAt ?? null,
      remindedToday: !!last && last.createdAt >= dayStart(istToday()),
      // Plan 09: "Tally se farq hai, pehle dekh lo". Only for those who may see Tally at all.
      ...(number?.unexplainedPaise && number.unexplainedPaise !== '0'
        ? { warnDifference: true }
        : {}),
    };
  }

  /**
   * One tap. Records that a person is reminding this customer and hands back a link with the words
   * filled in. Nothing is sent: the person sends it from their own WhatsApp, or does not. The words
   * and the amount are worked out here, from the balance now, never taken from the request.
   */
  @Can('crm.remind', scoped)
  @Post('customers/:id/reminder')
  @Contract(reminderSchema)
  remind(
    @Param('id') id: string,
    @Input(reminderSchema) input: z.infer<typeof reminderSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id, ...realCustomer },
        include: { khataSignoffs: { select: { id: true }, take: 1 } },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      const shop = await this.shopOf(tx, id, input.purpose, input.followUpId);
      if (!this.mayRemind(req, shop)) forbid(req, 'crm.remind');
      const blocked = reminderBlock({
        purpose: input.purpose,
        stopped: (await stoppedIds(tx as never, [customer])).has(id),
        signed: customer.khataSignoffs.length > 0,
        balancePaise: customer.khataBalancePaise,
        phone: customer.phone,
      });
      // Asked first, so a retry after a stop request gets the refusal and not the old link.
      if (blocked) fail(blockCode[blocked][0], blockCode[blocked][1], 409);
      const kind = input.purpose === 'QUIET' ? 'QUIET' : 'REMINDER';
      const text = this.words(input.purpose, customer);
      const reply = (contactId: string) => ({
        id: contactId,
        purpose: input.purpose,
        text,
        url: whatsappLink(customer.phone, text),
        phone: customer.phone,
      });
      const earlier = await tx.customerContact.findUnique({
        where: {
          customerId_idempotencyKey: { customerId: id, idempotencyKey: input.idempotencyKey },
        },
      });
      if (earlier) {
        if (earlier.kind !== kind)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return reply(earlier.id);
      }
      const today = await tx.customerContact.findFirst({
        where: { customerId: id, kind, createdAt: { gte: dayStart(istToday()) } },
        select: { createdAt: true },
      });
      if (today && !input.again)
        fail('REMINDED_TODAY', 'Someone already reminded this customer today.', 409, {
          at: today.createdAt,
        });
      const contact = await tx.customerContact.create({
        data: {
          customerId: id,
          actorId: req.user.id,
          channel: 'WHATSAPP',
          kind,
          purpose: kind === 'QUIET' ? 'Chup grahak ko yaad kiya' : 'Baaki ki yaad dilayi',
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CUSTOMER_REMINDED',
          entityId: id,
          ...(shop ? { locationId: shop } : {}),
          details: {
            contactId: contact.id,
            purpose: input.purpose,
            followUpId: input.followUpId ?? null,
            ...(input.purpose === 'PAYMENT' ? { balancePaise: customer.khataBalancePaise } : {}),
          },
        },
      });
      return reply(contact.id);
    });
  }

  /**
   * "Mujhe message mat karo." Anyone who reminds may write that down, at any shop. Only an owner may
   * take it back, because the customer's word should not be undone by the person chasing them.
   */
  @Can('crm.remind', scoped)
  @Put('customers/:id/reminder-stop')
  @Contract(reminderStopSchema)
  stop(
    @Param('id') id: string,
    @Input(reminderStopSchema) input: z.infer<typeof reminderStopSchema>,
    @Req() req: AuthRequest,
  ) {
    if (!input.stopped) requireAt(req, 'customers.edit');
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id, ...notStaff },
        select: { remindersStoppedAt: true },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      await setStopped(tx, id, input.stopped, customer.remindersStoppedAt, req.user.id);
      return { stopped: input.stopped };
    });
  }
}

/** Written once per change, by staff or by the customer. A repeat changes nothing. */
export async function setStopped(
  tx: Tx,
  customerId: string,
  stopped: boolean,
  was: Date | null,
  actorId: string,
) {
  if (stopped === !!was) return;
  await tx.user.update({
    where: { id: customerId },
    data: stopped
      ? { remindersStoppedAt: new Date(), remindersStoppedById: actorId }
      : { remindersStoppedAt: null, remindersStoppedById: null },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      event: stopped ? 'REMINDERS_STOPPED' : 'REMINDERS_RESUMED',
      entityId: customerId,
      details: {},
    },
  });
}

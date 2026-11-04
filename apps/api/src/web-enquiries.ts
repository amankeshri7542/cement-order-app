import { Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { webEnquirySchema, type WebEnquiryInput } from '@shiv/shared';
import { budget, clientIp } from './abuse';
import { Db } from './db';
import { AuthRequest, Can, Contract, fail, Input, Public } from './http';
import { OwnerWorkService } from './owner-work';
import { paginate } from './pagination';

const hour = 3600000;
// A visitor asks once or twice; a script asks hundreds of times. Mobile networks put many phones
// behind one address (Jio and Airtel use carrier NAT), so the address limit is generous and the
// per-number limit does the real work. The store-wide cap keeps a flood from burying real
// questions on the owner's Today screen, and its warning shows in security status.
const PER_IP_HOUR = 20;
const PER_PHONE_DAY = 5;
const STORE_PER_DAY = 300;
/** How long the privacy page says enquiries are kept. */
export const HANDLED_KEEP_DAYS = 180;
export const UNANSWERED_KEEP_DAYS = 365;

const listSchema = z.object({ status: z.enum(['NEW', 'HANDLED']).default('NEW') });
const select = {
  id: true,
  createdAt: true,
  name: true,
  phone: true,
  pincode: true,
  interest: true,
  message: true,
  language: true,
  status: true,
  handledAt: true,
} as const;

/**
 * "Ask the shop" from the website's Contact page. A visitor needs no account; the owner sees the
 * question on Today and phones back. Nothing is sent to the visitor automatically, so the form
 * cannot be used to make the shop message a stranger.
 */
@ApiTags('Website enquiries')
@Controller()
export class WebEnquiriesController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OwnerWorkService) private work: OwnerWorkService,
  ) {}

  @Public()
  @Post('web/enquiries')
  @Contract(webEnquirySchema)
  async create(@Input(webEnquirySchema) input: WebEnquiryInput, @Req() req: AuthRequest) {
    const ip = clientIp(req);
    // A robot that filled the hidden field gets the same answer as a person, so it learns nothing,
    // and it still spends its address's budget.
    const robot = Boolean(input.website?.trim());
    await this.db.atomic(async (tx) => {
      await budget(tx, 'enquiry:ip', ip, PER_IP_HOUR);
      if (robot) return;
      await budget(tx, 'enquiry:phone', input.phone, PER_PHONE_DAY, 24 * hour);
      await budget(tx, 'enquiry:global', 'store', STORE_PER_DAY, 24 * hour);
      const enquiry = await tx.webEnquiry.create({
        data: {
          name: input.name,
          phone: input.phone,
          pincode: input.pincode ?? null,
          interest: input.interest ?? null,
          message: input.message,
          language: input.language,
        },
        select: { id: true },
      });
      // No name, number or message in the audit trail: those are deleted on schedule.
      await tx.auditLog.create({
        data: {
          actorId: 'website',
          event: 'WEB_ENQUIRY_RECEIVED',
          entityId: enquiry.id,
          details: {},
        },
      });
    });
    if (!robot) this.work.stream.next({ type: 'ENQUIRY_RECEIVED' });
    return { received: true };
  }

  @Can('enquiries.handle') @Get('admin/enquiries')
  async list(@Query() query: Record<string, string>) {
    const parsed = listSchema.safeParse({ status: query.status });
    if (!parsed.success) fail('INVALID_INPUT', 'Choose NEW or HANDLED.');
    const { status } = parsed.data;
    const page = paginate(
      { limit: query.limit, cursor: query.cursor },
      `enquiries:${status}`,
      'createdAt',
      status === 'NEW' ? 'asc' : 'desc',
    );
    const rows = await this.db.webEnquiry.findMany({
      where: { AND: [{ status }, page.after] },
      orderBy: page.orderBy,
      take: page.take,
      select,
    });
    return page.finish(rows);
  }

  @Can('enquiries.handle') @Post('admin/enquiries/:id/handle')
  async handle(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!id || id.length > 100) fail('NOT_FOUND', 'This enquiry could not be found.', 404);
    const enquiry = await this.db.atomic(async (tx) => {
      const current = await tx.webEnquiry.findUnique({ where: { id }, select });
      if (!current) fail('NOT_FOUND', 'This enquiry could not be found.', 404);
      // Two owners tapping Done together both succeed; only the first is recorded.
      if (current.status === 'HANDLED') return current;
      const updated = await tx.webEnquiry.update({
        where: { id },
        data: { status: 'HANDLED', handledAt: new Date(), handledById: req.user.id },
        select,
      });
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'WEB_ENQUIRY_HANDLED', entityId: id, details: {} },
      });
      return updated;
    });
    this.work.stream.next({ type: 'ENQUIRY_HANDLED' });
    return enquiry;
  }
}

/** Maintenance: forget enquiries when the privacy page says they are forgotten. */
export function purgeEnquiries(db: Db, now = Date.now()) {
  return db.webEnquiry.deleteMany({
    where: {
      OR: [
        { status: 'HANDLED', handledAt: { lt: new Date(now - HANDLED_KEEP_DAYS * 86400000) } },
        { status: 'NEW', createdAt: { lt: new Date(now - UNANSWERED_KEEP_DAYS * 86400000) } },
      ],
    },
  });
}

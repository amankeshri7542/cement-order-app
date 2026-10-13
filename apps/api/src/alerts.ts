import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import webPush from 'web-push';
import { z } from 'zod';
import { pushSubscriptionSchema, staffUpdateSchema } from '@shiv/shared';
import { getConfig } from './config';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { paginate } from './pagination';

/** WhatsApp message templates. Each must be approved in Meta Business Manager with these names
 * and the same number of {{n}} placeholders before the real provider is switched on. */
export const whatsappTemplates = {
  shiv_new_order: 3, // नया ऑर्डर {{1}}, ₹{{2}}, क्षेत्र {{3}}
  shiv_new_quote: 2, // नया थोक भाव अनुरोध {{1}}, {{2}} सामग्री
  shiv_order_status: 2, // आपका ऑर्डर {{1}}: {{2}}
  shiv_test_alert: 1, // शिव सीमेंट स्टोर: {{1}} के लिए अलर्ट चालू है
} as const;
export type WhatsappTemplate = keyof typeof whatsappTemplates;

/** Adds a WhatsApp message to the outbox inside the caller's transaction (sent by the worker). */
export async function enqueueWhatsApp(
  tx: Prisma.TransactionClient,
  message: {
    userId?: string | null;
    phone: string;
    template: WhatsappTemplate;
    params: string[];
    dedupeKey: string;
  },
) {
  const recipient = message.phone.replace(/\D/g, '');
  if (recipient.length < 10) return;
  await tx.outboundMessage.upsert({
    where: { dedupeKey: message.dedupeKey },
    update: {},
    create: {
      userId: message.userId || null,
      channel: 'WHATSAPP',
      recipient,
      template: message.template,
      params: message.params.map((value) => value.slice(0, 120)),
      dedupeKey: message.dedupeKey,
    },
  });
}

const masked = (phone: string) => `…${phone.slice(-4)}`;
const log = (event: string, details: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));

@Injectable()
export class AlertsService {
  private vapidReady = false;
  constructor(@Inject(Db) private db: Db) {}

  pushKey() {
    return getConfig().WEB_PUSH_PUBLIC_KEY || null;
  }

  /** One worker pass: owner web push, then the WhatsApp outbox. Never throws. */
  async deliver() {
    await this.webPush().catch(() => log('WEB_PUSH_FAILED', {}));
    await this.whatsapp().catch(() => log('WHATSAPP_WORKER_FAILED', {}));
  }

  private async webPush() {
    const c = getConfig();
    if (!c.WEB_PUSH_PUBLIC_KEY || !c.WEB_PUSH_PRIVATE_KEY) return;
    if (!this.vapidReady) {
      webPush.setVapidDetails(c.WEB_PUSH_SUBJECT, c.WEB_PUSH_PUBLIC_KEY, c.WEB_PUSH_PRIVATE_KEY);
      this.vapidReady = true;
    }
    const pending = await this.db.notification.findMany({
      where: {
        pushedAt: null,
        createdAt: { gte: new Date(Date.now() - 6 * 3600000) },
        user: { role: 'ADMIN', pushSubscriptions: { some: {} } },
      },
      include: { user: { include: { pushSubscriptions: true } } },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
    for (const note of pending) {
      // Mark first: a crash mid-send must not repeat an alert the owner already heard.
      const claimed = await this.db.notification.updateMany({
        where: { id: note.id, pushedAt: null },
        data: { pushedAt: new Date() },
      });
      if (!claimed.count) continue;
      const payload = JSON.stringify({
        title: note.title,
        body: note.body,
        url: note.orderId ? `/#orders?order=${note.orderId}` : '/#quotes?queue=requested',
        tag: note.orderId || note.id,
      });
      for (const subscription of note.user.pushSubscriptions) {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: 3600, urgency: 'high' },
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The browser removed this subscription (app uninstalled or permission revoked).
          if (status === 404 || status === 410)
            await this.db.pushSubscription.deleteMany({ where: { id: subscription.id } });
          else log('WEB_PUSH_SEND_FAILED', { status: status || 0 });
        }
      }
    }
  }

  private async whatsapp() {
    const c = getConfig();
    const due = await this.db.outboundMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
    if (!due.length) return;
    const dayStart = new Date(
      `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00+05:30`,
    );
    let sentToday = await this.db.outboundMessage.count({
      where: { status: 'SENT', sentAt: { gte: dayStart } },
    });
    for (const message of due) {
      // A late "new order" alert is noise; past the daily budget the message is skipped.
      if (sentToday >= c.WHATSAPP_DAILY_LIMIT) {
        await this.db.outboundMessage.update({
          where: { id: message.id },
          data: { status: 'SKIPPED', lastError: 'Daily WhatsApp limit reached' },
        });
        continue;
      }
      try {
        const params = z.array(z.string()).parse(message.params);
        const providerId =
          c.WHATSAPP_PROVIDER === 'meta'
            ? await this.sendMeta(message.recipient, message.template, params)
            : `fake-${message.id}`;
        if (c.WHATSAPP_PROVIDER === 'fake')
          log('WHATSAPP_FAKE_SENT', {
            template: message.template,
            to: masked(message.recipient),
            params,
          });
        await this.db.outboundMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            providerId,
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        sentToday++;
      } catch (error) {
        const attempts = message.attempts + 1;
        await this.db.outboundMessage.update({
          where: { id: message.id },
          data: {
            attempts,
            status: attempts >= 5 ? 'FAILED' : 'PENDING',
            lastError:
              error instanceof Error ? error.message.slice(0, 300) : 'WhatsApp send failed',
            nextAttemptAt: new Date(Date.now() + 60000 * 2 ** attempts),
          },
        });
      }
    }
  }

  private async sendMeta(to: string, template: string, params: string[]) {
    const c = getConfig();
    const response = await fetch(
      `https://graph.facebook.com/${c.WHATSAPP_API_VERSION}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template,
            language: { code: c.WHATSAPP_TEMPLATE_LANGUAGE },
            components: [
              { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
            ],
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!response.ok || !body.messages?.[0]?.id)
      throw new Error(
        `WhatsApp ${response.status}${body.error?.code ? ` (${body.error.code})` : ''}: ${body.error?.message || 'not accepted'}`,
      );
    return body.messages[0].id;
  }
}

const staffSelect = {
  id: true,
  name: true,
  phone: true,
  staffTitle: true,
  whatsappAlerts: true,
  _count: { select: { pushSubscriptions: true } },
} as const;

@ApiTags('Owner alerts and staff')
@Admin()
@Controller('admin')
export class AlertsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AlertsService) private alerts: AlertsService,
  ) {}

  /** Shop staff with their roles and alert choices. Creating a staff login stays a terminal step. */
  @Get('staff') staff() {
    return this.db.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: staffSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  @Patch('staff/:id')
  @Contract(staffUpdateSchema)
  async updateStaff(
    @Param('id') id: string,
    @Input(staffUpdateSchema) body: z.infer<typeof staffUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id, role: 'ADMIN', deletedAt: null },
        data: body,
      });
      if (!changed.count) fail('NOT_FOUND', 'Staff member not found.', 404);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STAFF_UPDATED',
          entityId: id,
          details: { whatsappAlerts: body.whatsappAlerts },
        },
      });
      return tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect });
    });
  }

  @Get('push/key') key() {
    return { publicKey: this.alerts.pushKey() };
  }

  @Post('push/subscriptions')
  @Contract(pushSubscriptionSchema)
  async subscribe(
    @Input(pushSubscriptionSchema) body: z.infer<typeof pushSubscriptionSchema>,
    @Req() req: AuthRequest,
  ) {
    if (!this.alerts.pushKey())
      fail('PUSH_UNAVAILABLE', 'Alerts on this device are not set up on the server yet.', 503);
    await this.db.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { userId: req.user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
      create: {
        userId: req.user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });
    return { ok: true };
  }

  @Delete('push/subscriptions')
  async unsubscribe(@Body() body: { endpoint?: unknown }, @Req() req: AuthRequest) {
    const endpoint = z.string().url().max(1000).parse(body?.endpoint);
    await this.db.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
    return { ok: true };
  }

  /** Sends a test alert to the signed-in owner on every channel they have switched on. */
  @Post('alerts/test') async test(@Req() req: AuthRequest) {
    const owner = await this.db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    const stamp = new Date().toISOString();
    await this.db.atomic(async (tx) => {
      await tx.notification.create({
        data: {
          userId: owner.id,
          title: 'Test alert / जाँच अलर्ट',
          body: 'Alerts reach this device. / अलर्ट इस फ़ोन पर आ रहे हैं।',
        },
      });
      if (owner.whatsappAlerts)
        await enqueueWhatsApp(tx, {
          userId: owner.id,
          phone: owner.phone,
          template: 'shiv_test_alert',
          params: [owner.name || 'Shiv Cement Store'],
          dedupeKey: `wa:test:${owner.id}:${stamp}`,
        });
    });
    await this.alerts.deliver();
    return { ok: true, whatsapp: owner.whatsappAlerts, push: Boolean(this.alerts.pushKey()) };
  }

  /** Recent WhatsApp messages and their delivery state (no message bodies beyond the template). */
  @Get('alerts/messages') async messages(@Query() query: Record<string, string>) {
    const page = paginate(query, 'outbound');
    const rows = await this.db.outboundMessage.findMany({
      where: page.after,
      orderBy: page.orderBy,
      take: page.take,
      select: {
        id: true,
        template: true,
        recipient: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
      },
    });
    return page.finish(rows.map((row) => ({ ...row, recipient: masked(row.recipient) })));
  }

  @Post('alerts/messages/:id/retry') async retry(@Param('id') id: string) {
    const changed = await this.db.outboundMessage.updateMany({
      where: { id, status: { in: ['FAILED', 'SKIPPED'] } },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    if (!changed.count) fail('NOT_FOUND', 'Only failed or skipped messages can be retried.', 404);
    await this.alerts.deliver();
    return { ok: true };
  }
}

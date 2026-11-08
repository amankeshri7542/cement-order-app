import {
  Controller,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { productPhoto } from './product-assets';
import { budget, leased } from './abuse';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deviceSchema } from '@shiv/shared';
import { AuthRequest, Can, Contract, errorCause, fail, Input, Self } from './http';
import { getConfig } from './config';
import { WaDrafts } from './whatsapp/drafts';
import { WaSender } from './whatsapp/sender';
import { WaService } from './whatsapp/service';
import { Db } from './db';
import { sendBlocked } from './demo-lock';
import { OrdersService } from './orders';
import { OwnerWorkService } from './owner-work';
import { AlertsService } from './alerts';
import { istToday } from '@shiv/shared';
import { Attendance } from './staff/attendance';
import { TallyDesk } from './tally/desk';
import { TallyIngest } from './tally/ingest';
import { TallyRecon } from './tally/recon';
import { KhataService } from './khata';
import { purgeEnquiries } from './web-enquiries';
import { purgeAdvisor } from './advisor/core';

const laneNames = ['fast', 'release', 'timers', 'reader', 'sender', 'bulk'] as const;
type LaneName = (typeof laneNames)[number];
const laneEveryMs: Record<LaneName, number> = {
  reader: 3000,
  sender: 3000,
  fast: 20000,
  release: 30000,
  timers: 5 * 60000,
  bulk: 30000,
};
@Injectable()
export class Maintenance implements OnModuleInit, OnModuleDestroy {
  private timers: ReturnType<typeof setInterval>[] = [];
  private busy: Record<LaneName, boolean> = {
    fast: false,
    release: false,
    timers: false,
    reader: false,
    sender: false,
    bulk: false,
  };
  private khataCheckedDay = '';
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OrdersService) private orders: OrdersService,
    @Inject(OwnerWorkService) private ownerWork: OwnerWorkService,
    @Inject(AlertsService) private alerts: AlertsService,
    @Inject(KhataService) private khata: KhataService,
    @Inject(WaService) private wa: WaService,
    // Optional so the lanes can be tested without it. Nest always gives it.
    @Optional() @Inject(Attendance) private attendance?: Attendance,
    @Optional() @Inject(TallyIngest) private tallyIngest?: TallyIngest,
    @Optional() @Inject(TallyRecon) private tallyRecon?: TallyRecon,
    @Optional() @Inject(TallyDesk) private tallyDesk?: TallyDesk,
    @Optional() @Inject(WaSender) private waSender?: WaSender,
    @Optional() @Inject(WaDrafts) private waDrafts?: WaDrafts,
  ) {}
  onModuleInit() {
    const c = getConfig();
    if (c.NODE_ENV === 'test' || c.SHIV_ROLE === 'web') return;
    if (
      c.FIREBASE_PROJECT_ID &&
      c.FIREBASE_CLIENT_EMAIL &&
      c.FIREBASE_PRIVATE_KEY &&
      !getApps().length
    )
      initializeApp({
        credential: cert({
          projectId: c.FIREBASE_PROJECT_ID,
          clientEmail: c.FIREBASE_CLIENT_EMAIL,
          privateKey: c.FIREBASE_PRIVATE_KEY.replaceAll('\\n', '\n'),
        }),
      });
    for (const lane of laneNames) {
      const timer = setInterval(() => {
        void this.runLane(lane);
      }, laneEveryMs[lane]);
      timer.unref();
      this.timers.push(timer);
    }
  }
  onModuleDestroy() {
    for (const timer of this.timers) clearInterval(timer);
  }
  /** One pass of every lane, in order. */
  async run() {
    for (const lane of laneNames) await this.runLane(lane);
  }
  /**
   * Each lane has its own busy flag, so a slow provider holding up alerts cannot stop stock being
   * released or old sessions being cleared. Each step stands alone: one failing step (or a
   * missing grant) must not stop the rest.
   */
  async runLane(lane: LaneName) {
    if (this.busy[lane]) return;
    this.busy[lane] = true;
    let failed = '';
    try {
      for (const [step, task] of this.steps()[lane]) {
        try {
          await task();
        } catch (error) {
          failed = step;
          console.error(
            JSON.stringify({
              event: 'MAINTENANCE_FAILED',
              lane,
              step,
              ...errorCause(error),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
      await this.heartbeat(lane, failed);
    } finally {
      this.busy[lane] = false;
    }
  }
  /** Lets the system page show a stalled lane. It can never stop the work it reports on. */
  private async heartbeat(lane: LaneName, failed: string) {
    const now = new Date();
    const ok = failed ? {} : { lastOkAt: now };
    await this.db.workerHeartbeat
      .upsert({
        where: { lane },
        create: { lane, lastRunAt: now, lastStep: failed, ...ok },
        update: { lastRunAt: now, lastStep: failed, ...ok },
      })
      .catch((error) =>
        console.error(
          JSON.stringify({
            event: 'MAINTENANCE_FAILED',
            lane,
            step: 'heartbeat',
            ...errorCause(error),
            timestamp: new Date().toISOString(),
          }),
        ),
      );
  }
  private steps(): Record<LaneName, [string, () => Promise<unknown>][]> {
    return {
      // People are waiting on these, and each depends on an outside service.
      fast: [
        ['ownerWork', () => this.ownerWork.dispatch()],
        ['alerts', () => this.alerts.deliver()],
        ['devicePush', () => this.devicePush()],
      ],
      // Held stock goes back on time, even with every messaging service down.
      release: [['reservations', () => this.orders.expireReservations()]],
      // A slow model must not hold up anything else.
      reader: [['waRead', () => this.wa.runDue()]],
      // A person's confirmation must not wait behind a slow model.
      sender: [['waSend', async () => this.waSender?.sendDue()]],
      // Tally's day books can be large. Reading them must never hold up anything a person waits on.
      bulk: [
        ['tallyIngest', async () => this.tallyIngest?.runDue()],
        ['tallyRecon', async () => this.tallyRecon?.runDue()],
      ],
      // Housekeeping. Nobody notices a few minutes here.
      timers: [
        ['waPurge', () => this.wa.purge()],
        ['waDrafts', async () => this.waDrafts?.timers()],
        ['hazriNight', async () => this.attendance?.nightly()],
        ['hazriHousekeeping', async () => this.attendance?.housekeeping()],
        ['tallyAlerts', async () => this.tallyDesk?.watch()],
        ['purgeTallyChunks', async () => this.tallyDesk?.purge()],
        [
          'authRateLimits',
          async () => {
            const expired = await this.db.authRateLimit.findMany({
              where: { expiresAt: { lt: new Date() } },
              select: { key: true },
              take: 200,
            });
            if (expired.length)
              await this.db.authRateLimit.deleteMany({
                where: {
                  key: { in: expired.map((row) => row.key) },
                  expiresAt: { lt: new Date() },
                },
              });
          },
        ],
        [
          'demandOverrides',
          () =>
            this.db.demandOverride.deleteMany({
              where: { expiresAt: { lt: new Date(Date.now() - 30 * 86400000) } },
            }),
        ],
        [
          'khata',
          async () => {
            const today = istToday();
            if (this.khataCheckedDay === today) return;
            const result = await this.khata.checkBalances();
            this.khataCheckedDay = today;
            return result;
          },
        ],
        [
          'quotes',
          () =>
            this.db.quote.updateMany({
              where: { status: 'SENT', validUntil: { lt: new Date() } },
              data: { status: 'EXPIRED' },
            }),
        ],
        ['enquiries', () => purgeEnquiries(this.db)],
        ['advisor', () => purgeAdvisor(this.db)],
        [
          'sessions',
          () => this.db.session.deleteMany({ where: { refreshExpiresAt: { lt: new Date() } } }),
        ],
        [
          'checkoutReviews',
          () =>
            this.db.checkoutReview.deleteMany({
              where: { expiresAt: { lt: new Date(Date.now() - 86400000) }, order: null },
            }),
        ],
        [
          'pushTokens',
          () =>
            this.db.pushActionToken.deleteMany({
              where: { expiresAt: { lt: new Date(Date.now() - 86400000) } },
            }),
        ],
      ],
    };
  }
  private async devicePush() {
    if (!getApps().length) return;
    if (await sendBlocked(this.db)) return;
    const pending = await this.db.notification.findMany({
      where: {
        sentAt: null,
        attempts: { lt: 5 },
        OR: [{ sendAfter: null }, { sendAfter: { lte: new Date() } }],
      },
      take: 20,
      include: { user: { include: { devices: true } } },
    });
    for (const note of pending) {
      await this.db.notification.update({
        where: { id: note.id },
        data: { attempts: { increment: 1 } },
      });
      const tokens = note.user.devices.map((d) => d.token);
      if (tokens.length) {
        const result = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title: note.title, body: note.body },
          data: { notificationId: note.id, ...(note.orderId ? { orderId: note.orderId } : {}) },
        });
        for (let i = 0; i < result.responses.length; i++) {
          const code = result.responses[i]?.error?.code || '';
          if (
            [
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
            ].includes(code)
          )
            await this.db.device.deleteMany({ where: { token: tokens[i] } });
          else if (code)
            console.error(
              JSON.stringify({
                event: 'DEVICE_PUSH_FAILED',
                code,
                timestamp: new Date().toISOString(),
              }),
            );
        }
        // Retry only when no device received it: a retry goes to every device again, so a
        // partial failure would repeat the alert on the phones that already showed it.
        if (!result.successCount) continue;
      }
      await this.db.notification.update({
        where: { id: note.id },
        data: { sentAt: new Date() },
      });
    }
  }
}
@ApiTags('Integrations')
@Controller()
export class IntegrationsController {
  constructor(@Inject(Db) private db: Db) {}
  @Self()
  @Post('me/devices')
  @Contract(deviceSchema)
  device(@Input(deviceSchema) body: z.infer<typeof deviceSchema>, @Req() req: AuthRequest) {
    return this.db.device
      .upsert({
        where: { token: body.token },
        create: { ...body, userId: req.user.id, sessionId: req.sessionId },
        update: { ...body, userId: req.user.id, sessionId: req.sessionId },
      })
      .then(() => ({ ok: true }));
  }
  @Can('products.edit')
  @Post('admin/uploads')
  async upload(@Req() req: AuthRequest) {
    const c = getConfig();
    if (c.UPLOADS_PAUSED) fail('UPLOADS_PAUSED', 'Photo uploads are paused.', 503);
    if (!(
      c.R2_ENDPOINT &&
      c.R2_BUCKET &&
      c.R2_ACCESS_KEY_ID &&
      c.R2_SECRET_ACCESS_KEY &&
      c.R2_PUBLIC_URL
    ))
      fail('STORAGE_NOT_CONFIGURED', 'Configure object storage before uploading images.', 503);
    await this.db.atomic(async (tx) => {
      await budget(tx, 'photo:staff', req.user.id, 30);
      await budget(tx, 'photo:global', 'store', 200, 86400000);
    });
    return leased(this.db, 'photo', 2, 60000, async () => {
      const bytes = await productPhoto(
        req.body,
        String(req.headers['content-type'] || '').split(';')[0]!,
      );
      const key = `products/${randomUUID()}.webp`;
      const client = new S3Client({
        region: 'auto',
        endpoint: c.R2_ENDPOINT,
        maxAttempts: 1,
        credentials: { accessKeyId: c.R2_ACCESS_KEY_ID!, secretAccessKey: c.R2_SECRET_ACCESS_KEY! },
      });
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: c.R2_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: 'image/webp',
            ContentLength: bytes.length,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch {
        fail('STORAGE_UNAVAILABLE', 'Photo storage is unavailable. Try again later.', 503);
      } finally {
        client.destroy();
      }
      const publicUrl = `${new URL(c.R2_PUBLIC_URL!).origin}/${key}`;
      await this.db.productAsset.create({ data: { id: key, url: publicUrl } });
      await this.db.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'PRODUCT_PHOTO_VALIDATED',
          entityId: key,
          details: { bytes: bytes.length },
        },
      });
      return { publicUrl };
    });
  }
}

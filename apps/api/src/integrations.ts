import {
  Controller,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
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
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { getConfig } from './config';
import { Db } from './db';
import { OrdersService } from './orders';
import { OwnerWorkService } from './owner-work';

@Injectable()
export class Maintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OrdersService) private orders: OrdersService,
    @Inject(OwnerWorkService) private ownerWork: OwnerWorkService,
  ) {}
  onModuleInit() {
    if (getConfig().NODE_ENV === 'test') return;
    const c = getConfig();
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
    this.timer = setInterval(() => {
      void this.run();
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async run() {
    // ponytail: one API instance owns this worker; claim rows transactionally before scaling out.
    if (this.busy) return;
    this.busy = true;
    try {
      const expired = await this.db.authRateLimit.findMany({
        where: { expiresAt: { lt: new Date() } },
        select: { key: true },
        take: 200,
      });
      if (expired.length)
        await this.db.authRateLimit.deleteMany({
          where: { key: { in: expired.map((row) => row.key) }, expiresAt: { lt: new Date() } },
        });
      await this.db.demandOverride.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      });
      await this.ownerWork.dispatch();
      await this.orders.expireReservations();
      await this.db.quote.updateMany({
        where: { status: 'SENT', validUntil: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
      await this.db.session.deleteMany({ where: { refreshExpiresAt: { lt: new Date() } } });
      await this.db.checkoutReview.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 86400000) }, order: null },
      });
      if (getApps().length) {
        const pending = await this.db.notification.findMany({
          where: { sentAt: null, attempts: { lt: 5 } },
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
            for (let i = 0; i < result.responses.length; i++)
              if (
                [
                  'messaging/registration-token-not-registered',
                  'messaging/invalid-registration-token',
                ].includes(result.responses[i]?.error?.code || '')
              )
                await this.db.device.deleteMany({ where: { token: tokens[i] } });
            if (result.failureCount) continue;
          }
          await this.db.notification.update({
            where: { id: note.id },
            data: { sentAt: new Date() },
          });
        }
      }
    } catch {
      console.error(
        JSON.stringify({ event: 'MAINTENANCE_FAILED', timestamp: new Date().toISOString() }),
      );
    } finally {
      this.busy = false;
    }
  }
}
@ApiTags('Integrations')
@Controller()
export class IntegrationsController {
  constructor(@Inject(Db) private db: Db) {}
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
  @Admin()
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

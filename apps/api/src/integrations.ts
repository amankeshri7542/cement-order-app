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
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deviceSchema, uploadSchema } from '@shiv/shared';
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { getConfig } from './config';
import { Db } from './db';
import { OrdersService } from './orders';

@Injectable()
export class Maintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OrdersService) private orders: OrdersService,
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
  @Contract(uploadSchema)
  async upload(@Input(uploadSchema) body: z.infer<typeof uploadSchema>) {
    const c = getConfig();
    if (!(
      c.R2_ENDPOINT &&
      c.R2_BUCKET &&
      c.R2_ACCESS_KEY_ID &&
      c.R2_SECRET_ACCESS_KEY &&
      c.R2_PUBLIC_URL
    ))
      fail('STORAGE_NOT_CONFIGURED', 'Configure object storage before uploading images.', 503);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[body.contentType];
    const key = `products/${randomUUID()}.${ext}`;
    const client = new S3Client({
      region: 'auto',
      endpoint: c.R2_ENDPOINT,
      credentials: { accessKeyId: c.R2_ACCESS_KEY_ID, secretAccessKey: c.R2_SECRET_ACCESS_KEY },
    });
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: c.R2_BUCKET,
        Key: key,
        ContentType: body.contentType,
        ContentLength: body.size,
      }),
      { expiresIn: 120 },
    );
    return { uploadUrl, publicUrl: `${c.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}` };
  }
}

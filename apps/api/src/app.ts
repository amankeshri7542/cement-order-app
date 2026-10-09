import { raw, json } from 'express';
import { RateStudioController, RateStudioService } from './rate-studio/studio';
import { RateProviders } from './rate-studio/providers';
import { RateStorage } from './rate-studio/storage';
import 'reflect-metadata';
import { OperationsController } from './operations';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuthController, AuthGuard, AuthService } from './auth';
import { AccountController, CatalogController, Events } from './catalog';
import { Db } from './db';
import { OwnerWorkController, OwnerWorkService } from './owner-work';
import { Errors, Public } from './http';
import { getConfig } from './config';
import { OrdersController, OrdersService } from './orders';
import { PaymentsController, PaymentsService } from './payments';
import { QuotesController } from './quotes';
import { AdminController } from './admin';
import { IntegrationsController, Maintenance } from './integrations';

@Controller('health')
class HealthController {
  constructor(@Inject(Db) private db: Db) {}
  @Public() @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 10000 : 120 }]),
  ],
  controllers: [
    OwnerWorkController,
    AuthController,
    CatalogController,
    AccountController,
    OrdersController,
    PaymentsController,
    QuotesController,
    AdminController,
    IntegrationsController,
    HealthController,
    OperationsController,
    RateStudioController,
  ],
  providers: [
    OwnerWorkService,
    Db,
    RateStudioService,
    RateProviders,
    RateStorage,
    AuthService,
    Events,
    OrdersService,
    PaymentsService,
    Maintenance,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
export async function createApp() {
  const c = getConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().set('trust proxy', c.TRUST_PROXY_HOPS);
  app.setGlobalPrefix('api/v1');
  const rateJson = json({ limit: '512kb' });
  app.use(
    '/api/v1/admin/rate-studio',
    raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    (req: Request, res: Response, next: NextFunction) => rateJson(req, res, next),
  );
  app.use('/api/v1/admin/uploads', raw({ type: '*/*', limit: '5mb' }));
  app.use(helmet());
  app.enableCors({
    origin: c.CORS_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      if (c.NODE_ENV !== 'test')
        console.log(
          JSON.stringify({
            event: 'HTTP_REQUEST',
            requestId: req.requestId,
            method: req.method,
            status: res.statusCode,
            timestamp: new Date().toISOString(),
          }),
        );
    });
    next();
  });
  app.useGlobalFilters(new Errors());
  if (c.NODE_ENV !== 'production')
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Shiv Cement Store API')
          .setVersion('1.0')
          .addBearerAuth()
          .build(),
      ),
    );
  const server = app.getHttpServer();
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  app.enableShutdownHooks();
  return app;
}

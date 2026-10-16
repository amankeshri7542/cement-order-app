import { raw, json } from 'express';
import { AssistantController, AssistantService, AssistantProvider } from './assistant';
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
import { Errors, Public, cookie, fail } from './http';
import { getConfig } from './config';
import { OrdersController, OrdersService } from './orders';
import { PaymentsController, PaymentsService } from './payments';
import { QuotesController } from './quotes';
import { AdminController } from './admin';
import { IntegrationsController, Maintenance } from './integrations';
import { Lifecycle, requestId } from './lifecycle';
import { AlertsController, AlertsService } from './alerts';
import { ReportsController } from './reports';

@Controller('health')
class HealthController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Lifecycle) private lifecycle: Lifecycle,
  ) {}
  // Kept for existing platform checks: process up and database reachable.
  @Public() @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
  // Liveness: the process answers. Never touches the database, so a database outage does not
  // make an orchestrator restart a healthy process in a loop.
  @Public() @Get('live') live() {
    return { status: 'ok' };
  }
  // Readiness: safe to route customers here. Fails while draining or when the database does not
  // answer within two seconds. Migration state is checked by the release job, because the
  // restricted runtime role intentionally cannot read _prisma_migrations.
  @Public() @Get('ready') async ready() {
    if (this.lifecycle.draining) fail('DRAINING', 'This instance is shutting down.', 503);
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 2000);
      timer.unref();
    });
    try {
      await Promise.race([this.db.$queryRaw`SELECT 1`, timeout]);
    } catch {
      fail('DATABASE_UNAVAILABLE', 'The database is not reachable.', 503);
    }
    return { status: 'ready' };
  }
}
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 10000 : 120 }]),
  ],
  controllers: [
    AssistantController,
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
    AlertsController,
    ReportsController,
  ],
  providers: [
    AssistantService,
    AssistantProvider,
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
    AlertsService,
    Lifecycle,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
/**
 * A cheap credential-shaped check only; AuthGuard still verifies the session afterwards. Bodies
 * announced above 5 MB are left to raw(), which refuses them (413) without buffering them.
 */
export function uploadGate(
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction,
) {
  if (
    req.method === 'OPTIONS' ||
    /^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization || '') ||
    cookie(req, 'shiv_access')
  )
    return next();
  res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Please sign in to continue.',
      requestId: req.requestId,
    },
  });
}
export async function createApp() {
  const c = getConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().set('trust proxy', c.TRUST_PROXY_HOPS);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: c.CORS_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    // Reuse a proxy's correlation ID only when a trusted proxy is configured.
    req.requestId =
      c.TRUST_PROXY_HOPS > 0 ? requestId(req.headers['x-request-id'], randomUUID) : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      if (c.NODE_ENV !== 'test')
        console.log(
          JSON.stringify({
            event: 'HTTP_REQUEST',
            requestId: req.requestId,
            method: req.method,
            // Route pattern, not the URL: no query strings, search terms or record IDs in logs.
            route: req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched',
            status: res.statusCode,
            durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
            timestamp: new Date().toISOString(),
          }),
        );
    });
    next();
  });
  // Staff upload routes read bodies of up to 5 MB before Nest's guards run. Refuse requests that
  // carry no credential before reading any of the body.
  app.use(['/api/v1/admin/uploads', '/api/v1/admin/rate-studio'], uploadGate);
  const rateJson = json({ limit: '512kb' });
  app.use(
    '/api/v1/admin/rate-studio',
    raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    (req: Request, res: Response, next: NextFunction) => rateJson(req, res, next),
  );
  app.use('/api/v1/admin/uploads', raw({ type: '*/*', limit: '5mb' }));
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
  // Signal handling lives in main.ts (see lifecycle.ts) so HTTP drains before teardown.
  return app;
}

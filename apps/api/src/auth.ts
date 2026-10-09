import { leased } from './abuse';
import {
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { otpRequestSchema, otpVerifySchema, refreshSchema } from '@shiv/shared';
import { Db } from './db';
import { getConfig } from './config';
import { AuthRequest, Contract, Input, Public, cookie, fail, hash, safeEqual } from './http';
import { assertSession, limitOtp, refreshLifetime, verifyPassword } from './security';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    if (
      getConfig().OTP_PROVIDER === 'mock' &&
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
    )
      fail('FORBIDDEN', 'Mock authentication is restricted to local loopback requests.', 403);
    // Cookie-authenticated writes require an exact trusted Origin, including login/logout.
    const origin = req.headers.origin;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (origin || req.headers.cookie) &&
      !getConfig()
        .CORS_ORIGINS.split(',')
        .includes(origin || '')
    )
      fail('FORBIDDEN', 'Request origin is not allowed.', 403);
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()]))
      return true;
    const token =
      req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ||
      cookie(req, 'shiv_access');
    if (!token) fail('UNAUTHORIZED', 'Please sign in to continue.', 401);
    const session = await this.db.session.findUnique({
      where: { accessHash: hash(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date())
      fail('UNAUTHORIZED', 'Your session expired. Sign in again.', 401);
    await assertSession(this.db, session);
    req.user = session.user;
    req.sessionId = session.id;
    req.sessionAccessHash = session.accessHash;
    if (
      this.reflector.getAllAndOverride<boolean>('admin', [ctx.getHandler(), ctx.getClass()]) &&
      session.user.role !== 'ADMIN'
    )
      fail('FORBIDDEN', 'Store staff access is required.', 403);
    if (session.lastSeenAt.getTime() < Date.now() - 60000)
      await this.db.session.updateMany({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    return true;
  }
}

@Injectable()
export class AuthService {
  constructor(@Inject(Db) private db: Db) {}
  private otpHash(phone: string, code: string) {
    return createHmac('sha256', getConfig().OTP_HASH_SECRET)
      .update(`${phone}:${code}`)
      .digest('hex');
  }
  private async twilio(path: string, params: URLSearchParams) {
    const c = getConfig();
    const result = await leased(this.db, 'otp', 4, 15000, () =>
      fetch(`https://verify.twilio.com/v2/Services/${c.TWILIO_VERIFY_SERVICE_SID}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.TWILIO_ACCOUNT_SID}:${c.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
        body: params,
        signal: AbortSignal.timeout(10000),
      }),
    ).catch(() =>
      fail('OTP_UNAVAILABLE', 'SMS verification is unavailable. Try again shortly.', 503),
    );
    if (path === 'VerificationCheck' && result.status === 404)
      fail('INVALID_OTP', 'Code expired or already used. Request a new one.', 401);
    if (!result.ok)
      fail('OTP_UNAVAILABLE', 'Could not verify your number. Try again shortly.', 503);
    const body = await result.json().catch(() => null);
    if (!body || typeof body.status !== 'string')
      fail('OTP_UNAVAILABLE', 'SMS verification is unavailable. Try again shortly.', 503);
    return body as { status: string };
  }
  private async verifyStaff(
    db: Pick<Prisma.TransactionClient, 'adminCredential'>,
    userId: string,
    adminPassword?: string,
  ) {
    const credential = await db.adminCredential.findUnique({ where: { userId } });
    if (credential) {
      if (!adminPassword || !(await verifyPassword(adminPassword, credential.passwordHash)))
        fail('INVALID_CREDENTIALS', 'The sign-in details could not be verified.', 401);
      return new Date();
    }
    if (getConfig().NODE_ENV === 'production')
      fail('ADMIN_SETUP_REQUIRED', 'Staff authentication must be configured by the store.', 403);
    // Development-only fixture exception: no credential permits OTP-only local staff login.
    return null;
  }
  async request(phone: string) {
    const code = String(randomInt(100000, 1000000));
    const now = new Date();
    await this.db.atomic(async (tx) => {
      const old = await tx.otpChallenge.findUnique({ where: { phone } });
      if (
        old &&
        (now.getTime() - old.sentAt.getTime() < 60000 ||
          (now.getTime() - old.windowStart.getTime() < 3600000 && old.sends >= 5))
      )
        fail('RATE_LIMITED', 'Wait before requesting another code.', 429);
      const freshWindow = !old || now.getTime() - old.windowStart.getTime() >= 3600000;
      const data = {
        codeHash: this.otpHash(phone, code),
        expiresAt: new Date(now.getTime() + 300000),
        sentAt: now,
        consumed: false,
        attempts: 0,
        windowStart: freshWindow ? now : old.windowStart,
        sends: freshWindow ? 1 : old.sends + 1,
      };
      await tx.otpChallenge.upsert({ where: { phone }, create: { phone, ...data }, update: data });
    });
    if (getConfig().OTP_PROVIDER === 'twilio')
      await this.twilio('Verifications', new URLSearchParams({ To: phone, Channel: 'sms' }));
    return {
      sent: true,
      expiresIn: 300,
      ...(getConfig().OTP_PROVIDER === 'mock'
        ? { devCode: code, message: 'Development only: no SMS was sent.' }
        : {}),
    };
  }
  async verify(phone: string, code: string, adminPassword?: string, label = 'Unknown device') {
    const challenge = await this.db.otpChallenge.findUnique({ where: { phone } });
    if (
      !challenge ||
      challenge.consumed ||
      challenge.expiresAt < new Date() ||
      challenge.attempts >= 5
    )
      fail('INVALID_OTP', 'Code expired or invalid. Request a new one.', 401);
    const attempt = await this.db.otpChallenge.updateMany({
      where: {
        phone,
        codeHash: challenge.codeHash,
        consumed: false,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      data: { attempts: { increment: 1 } },
    });
    if (!attempt.count) fail('INVALID_OTP', 'Code expired or invalid.', 401);
    // Twilio deletes an approved verification. Check the passphrase before consuming it.
    const existing = await this.db.user.findUnique({ where: { phone } });
    if (existing?.deletedAt) fail('UNAUTHORIZED', 'This account has been deleted.', 401);
    if (existing?.role === 'ADMIN') await this.verifyStaff(this.db, existing.id, adminPassword);
    const valid =
      getConfig().OTP_PROVIDER === 'mock'
        ? safeEqual(challenge.codeHash, this.otpHash(phone, code))
        : (await this.twilio('VerificationCheck', new URLSearchParams({ To: phone, Code: code })))
            .status === 'approved';
    if (!valid) fail('INVALID_OTP', 'That code is not correct.', 401);
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    return this.db.atomic(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({
        where: {
          phone,
          codeHash: challenge.codeHash,
          consumed: false,
          expiresAt: { gt: new Date() },
        },
        data: { consumed: true },
      });
      if (!consumed.count) fail('INVALID_OTP', 'Code already used. Request a new one.', 401);
      const user = await tx.user.upsert({ where: { phone }, create: { phone }, update: {} });
      if (user.deletedAt) fail('UNAUTHORIZED', 'This account has been deleted.', 401);
      // Recheck inside the transaction in case staff credentials changed during verification.
      const adminVerifiedAt =
        user.role === 'ADMIN' ? await this.verifyStaff(tx, user.id, adminPassword) : null;
      await tx.session.create({
        data: {
          userId: user.id,
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          label: label.slice(0, 160),
          adminVerifiedAt,
          expiresAt: new Date(Date.now() + 1800000),
          refreshExpiresAt: new Date(Date.now() + refreshLifetime(user.role)),
        },
      });
      return { user, accessToken, refreshToken };
    });
  }
  async refresh(token: string) {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    return this.db.atomic(async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshHash: hash(token) },
        include: { user: true },
      });
      if (!session || session.refreshExpiresAt < new Date())
        fail('UNAUTHORIZED', 'Please sign in again.', 401);
      await assertSession(tx, session);
      await tx.session.update({
        where: { id: session.id },
        data: {
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          expiresAt: new Date(Date.now() + 1800000),
          lastSeenAt: new Date(),
        },
      });
      return { user: session.user, accessToken, refreshToken };
    });
  }
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(Db) private db: Db,
  ) {}
  private sendSession(
    result: Awaited<ReturnType<AuthService['verify']>>,
    req: AuthRequest,
    res: Response,
  ) {
    const options = {
      httpOnly: true,
      secure: getConfig().NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/api/v1',
    };
    if (req.headers.origin) {
      res.cookie('shiv_access', result.accessToken, { ...options, maxAge: 1800000 });
      res.cookie('shiv_refresh', result.refreshToken, {
        ...options,
        maxAge: refreshLifetime(result.user.role),
      });
      return { user: result.user };
    }
    return result;
  }
  @Public()
  @Post('otp/request')
  @Contract(otpRequestSchema)
  async request(
    @Input(otpRequestSchema) body: z.infer<typeof otpRequestSchema>,
    @Req() req: AuthRequest,
  ) {
    await limitOtp(this.db, req.ip || req.socket.remoteAddress || 'unknown', 'send');
    return this.auth.request(body.phone);
  }
  @Public()
  @Post('otp/verify')
  @Contract(otpVerifySchema)
  async verify(
    @Input(otpVerifySchema) body: z.infer<typeof otpVerifySchema>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await limitOtp(this.db, req.ip || req.socket.remoteAddress || 'unknown', 'verify');
    return this.sendSession(
      await this.auth.verify(
        body.phone,
        body.code,
        body.adminPassword,
        req.get('user-agent') || 'Unknown device',
      ),
      req,
      res,
    );
  }
  @Public()
  @Post('refresh')
  @Contract(refreshSchema)
  async refresh(
    @Input(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken || cookie(req, 'shiv_refresh');
    if (!token) fail('UNAUTHORIZED', 'Please sign in again.', 401);
    return this.sendSession(await this.auth.refresh(token), req, res);
  }
  @Public()
  @Post('logout')
  @Contract(refreshSchema)
  async logout(
    @Input(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const access = req.headers.authorization?.slice(7) || cookie(req, 'shiv_access');
    const refresh = body.refreshToken || cookie(req, 'shiv_refresh');
    await this.db.session.deleteMany({
      where: {
        OR: [
          ...(access ? [{ accessHash: hash(access) }] : []),
          ...(refresh ? [{ refreshHash: hash(refresh) }] : []),
        ],
      },
    });
    for (const name of ['shiv_access', 'shiv_refresh']) res.clearCookie(name, { path: '/api/v1' });
    return { ok: true };
  }
  @Get('session') session(@Req() req: AuthRequest) {
    return { user: req.user };
  }
  @Get('sessions') async sessions(@Req() req: AuthRequest) {
    const sessions = await this.db.session.findMany({
      where: { userId: req.user.id, refreshExpiresAt: { gt: new Date() } },
      select: {
        id: true,
        label: true,
        createdAt: true,
        lastSeenAt: true,
        _count: { select: { devices: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map(({ _count, ...session }) => ({
      ...session,
      current: session.id === req.sessionId,
      deviceCount: _count.devices,
    }));
  }
  @Delete('sessions/:id') async revoke(@Param('id') id: string, @Req() req: AuthRequest) {
    const result = await this.db.session.deleteMany({ where: { id, userId: req.user.id } });
    if (!result.count) fail('NOT_FOUND', 'Session not found.', 404);
    return { ok: true };
  }
  @Post('sessions/revoke-others') async revokeOthers(@Req() req: AuthRequest) {
    const result = await this.db.session.deleteMany({
      where: { userId: req.user.id, id: { not: req.sessionId } },
    });
    return { ok: true, revoked: result.count };
  }
}

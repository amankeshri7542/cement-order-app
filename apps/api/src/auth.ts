import { t } from '@shiv/i18n';
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
  Patch,
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
import {
  assertSession,
  assertStaffAttempts,
  limitOtp,
  otpBudget,
  recordStaffFailure,
  refreshLifetime,
  verifyPassword,
} from './security';

// One answer for every failed staff sign-in, whichever factor was wrong.
const staffRejection = 'The sign-in details could not be verified.';
// How long a rotated-out refresh token may repeat its refresh (a reply lost on a weak signal).
const refreshGraceMs = 5 * 60000;

// Headers added by TLS-terminating tunnels and proxies (ngrok, cloudflared, nginx and similar).
// A bare X-Forwarded-For is not listed: Express ignores it while TRUST_PROXY_HOPS=0, and the
// OTP budget tests rely on spoofed values reaching (and being ignored by) the rate limiter.
const forwardingHeaders = [
  'forwarded',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
  'true-client-ip',
  'x-original-host',
];
/**
 * Mock OTP shows sign-in codes on screen, so it must only serve this computer directly. A
 * tunnel or reverse proxy on the same machine also connects from 127.0.0.1, so requests that
 * carry tunnel/proxy headers or a non-loopback Host (tunnel hostname, DNS rebinding) are
 * refused. A local proxy that adds no headers and rewrites Host cannot be detected here; mock
 * OTP therefore also binds to loopback and refuses TRUST_PROXY_HOPS > 0 at startup.
 */
export function directLoopback(req: Pick<AuthRequest, 'socket' | 'headers'>) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''))
    return false;
  if (forwardingHeaders.some((name) => req.headers[name] !== undefined)) return false;
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  );
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    if (getConfig().OTP_PROVIDER === 'mock' && !directLoopback(req))
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
    if (req.headers['x-shiv-account'] && req.headers['x-shiv-account'] !== session.user.id)
      fail('ACCOUNT_CHANGED', 'The signed-in account changed. Refresh before continuing.', 409);
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
        data: {
          lastSeenAt: new Date(),
          ...(session.user.role === 'ADMIN' && !getConfig().STAFF_PASSPHRASE_REQUIRED
            ? { refreshExpiresAt: new Date(Date.now() + refreshLifetime('ADMIN')) }
            : {}),
        },
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
    // Twilio answers 404 once a verification has expired, been approved or used up its attempts.
    if (path === 'VerificationCheck' && result.status === 404) return { status: 'expired' };
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
    failures?: { db: Db; ip: string },
  ) {
    if (!getConfig().STAFF_PASSPHRASE_REQUIRED) return new Date();
    const credential = await db.adminCredential.findUnique({ where: { userId } });
    if (credential) {
      if (!adminPassword || !(await verifyPassword(adminPassword, credential.passwordHash))) {
        // Only guesses count towards the lockout; a missing passphrase guesses nothing.
        if (failures && adminPassword) await recordStaffFailure(failures.db, userId, failures.ip);
        fail('INVALID_OTP', staffRejection, 401);
      }
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
      await otpBudget(tx, 'send');
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
  async verify(
    phone: string,
    code: string,
    adminPassword?: string,
    label = 'Unknown device',
    ip = 'unknown',
  ) {
    const challenge = await this.db.otpChallenge.findUnique({ where: { phone } });
    if (
      !challenge ||
      challenge.consumed ||
      challenge.expiresAt < new Date() ||
      challenge.attempts >= 5
    )
      fail('INVALID_OTP', 'Code expired or invalid. Request a new one.', 401);
    // Only checks against a live challenge use the store-wide budget, so junk calls cannot.
    const attempt = await this.db.atomic(async (tx) => {
      const counted = await tx.otpChallenge.updateMany({
        where: {
          phone,
          codeHash: challenge.codeHash,
          consumed: false,
          expiresAt: { gt: new Date() },
          attempts: { lt: 5 },
        },
        data: { attempts: { increment: 1 } },
      });
      if (counted.count) await otpBudget(tx, 'verify');
      return counted;
    });
    if (!attempt.count) fail('INVALID_OTP', 'Code expired or invalid.', 401);
    const status =
      getConfig().OTP_PROVIDER === 'mock'
        ? safeEqual(challenge.codeHash, this.otpHash(phone, code))
          ? 'approved'
          : 'pending'
        : (await this.twilio('VerificationCheck', new URLSearchParams({ To: phone, Code: code })))
            .status;
    if (status !== 'approved') {
      if (status === 'expired')
        fail('INVALID_OTP', 'Code expired or already used. Request a new one.', 401);
      fail('INVALID_OTP', staffRejection, 401);
    }
    const existing = await this.db.user.findUnique({ where: { phone } });
    if (existing?.deletedAt) fail('UNAUTHORIZED', 'This account has been deleted.', 401);
    if (existing?.role === 'ADMIN' && getConfig().STAFF_PASSPHRASE_REQUIRED) {
      await assertStaffAttempts(this.db, existing.id, ip);
      await this.verifyStaff(this.db, existing.id, adminPassword, { db: this.db, ip });
    }
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
          label:
            user.role === 'ADMIN'
              ? t(
                  /iPad|Tablet/i.test(label)
                    ? 'owner.deviceTablet'
                    : /iPhone/i.test(label)
                      ? 'owner.deviceIphone'
                      : /Android/i.test(label)
                        ? 'owner.deviceAndroid'
                        : /Windows|Macintosh|Linux/i.test(label)
                          ? 'owner.deviceComputer'
                          : 'owner.deviceFallback',
                )
              : label.slice(0, 160),
          adminVerifiedAt,
          expiresAt: new Date(Date.now() + 1800000),
          refreshExpiresAt: new Date(Date.now() + refreshLifetime(user.role)),
        },
      });
      return { user, accessToken, refreshToken };
    });
  }
  async refresh(token: string) {
    // The next pair is derived from the presented token, so a repeat of the same refresh (a lost
    // reply, or two tabs refreshing at once) gets the same pair instead of orphaning the other.
    const derive = (kind: string) =>
      createHmac('sha256', getConfig().OTP_HASH_SECRET)
        .update(`refresh-rotation:${kind}:${token}`)
        .digest('base64url');
    const accessToken = derive('access');
    const refreshToken = derive('refresh');
    const presented = hash(token);
    const result = await this.db.atomic(async (tx) => {
      const session = await tx.session.findFirst({
        where: { OR: [{ refreshHash: presented }, { previousRefreshHash: presented }] },
        include: { user: true },
      });
      if (!session || session.refreshExpiresAt < new Date())
        fail('UNAUTHORIZED', 'Please sign in again.', 401);
      const previous = session.refreshHash !== presented;
      if (
        previous &&
        !(session.previousRefreshUntil && session.previousRefreshUntil > new Date())
      ) {
        // A rotated-out token came back after its grace window: someone else holds a copy of it.
        // End the session for both holders; the owner signs in again with a new code.
        await tx.session.delete({ where: { id: session.id } });
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            event: 'REFRESH_TOKEN_REUSED',
            entityId: session.id,
            details: { label: session.label },
          },
        });
        return null;
      }
      await assertSession(tx, session);
      await tx.session.update({
        where: { id: session.id },
        data: {
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          // A repeat with the previous token returns the same pair and keeps the original grace
          // window, so the window cannot be stretched by retrying.
          ...(previous
            ? {}
            : {
                previousRefreshHash: presented,
                previousRefreshUntil: new Date(Date.now() + refreshGraceMs),
              }),
          expiresAt: new Date(Date.now() + 1800000),
          lastSeenAt: new Date(),
          ...(session.user.role === 'ADMIN' && !getConfig().STAFF_PASSPHRASE_REQUIRED
            ? { refreshExpiresAt: new Date(Date.now() + refreshLifetime('ADMIN')) }
            : {}),
        },
      });
      return { user: session.user, accessToken, refreshToken };
    });
    if (!result) {
      console.warn(JSON.stringify({ event: 'REFRESH_TOKEN_REUSED' }));
      fail('UNAUTHORIZED', 'Please sign in again.', 401);
    }
    return result;
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
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await limitOtp(this.db, ip, 'verify');
    return this.sendSession(
      await this.auth.verify(
        body.phone,
        body.code,
        body.adminPassword,
        req.get('user-agent') || 'Unknown device',
        ip,
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
          // A sign-out racing a refresh still ends the session it rotated.
          ...(refresh
            ? [{ refreshHash: hash(refresh) }, { previousRefreshHash: hash(refresh) }]
            : []),
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
  @Patch('sessions/:id')
  @Contract(z.strictObject({ label: z.string().trim().min(1).max(100) }))
  async rename(
    @Param('id') id: string,
    @Input(z.strictObject({ label: z.string().trim().min(1).max(100) })) body: { label: string },
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const changed = await tx.session.updateMany({
        where: { id, userId: req.user.id },
        data: { label: body.label },
      });
      if (!changed.count) fail('NOT_FOUND', 'Session not found.', 404);
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'SESSION_RENAMED', entityId: id, details: {} },
      });
      return { ok: true };
    });
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

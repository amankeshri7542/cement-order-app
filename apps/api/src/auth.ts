import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiTags } from '@nestjs/swagger';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { otpRequestSchema, otpVerifySchema, refreshSchema } from '@shiv/shared';
import { Db } from './db';
import { getConfig } from './config';
import { AuthRequest, Contract, Input, Public, cookie, fail, hash, safeEqual } from './http';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
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
    if (!session || session.expiresAt < new Date())
      fail('UNAUTHORIZED', 'Your session expired. Sign in again.', 401);
    req.user = session.user;
    req.sessionId = session.id;
    if (
      this.reflector.getAllAndOverride<boolean>('admin', [ctx.getHandler(), ctx.getClass()]) &&
      session.user.role !== 'ADMIN'
    )
      fail('FORBIDDEN', 'Store staff access is required.', 403);
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
    const result = await fetch(
      `https://verify.twilio.com/v2/Services/${c.TWILIO_VERIFY_SERVICE_SID}/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.TWILIO_ACCOUNT_SID}:${c.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
        body: params,
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!result.ok)
      fail('OTP_UNAVAILABLE', 'Could not verify your number. Try again shortly.', 503);
    return (await result.json()) as { status: string };
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
  async verify(phone: string, code: string) {
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
      await tx.session.create({
        data: {
          userId: user.id,
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          expiresAt: new Date(Date.now() + 1800000),
          refreshExpiresAt: new Date(Date.now() + 30 * 86400000),
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
      await tx.session.update({
        where: { id: session.id },
        data: {
          accessHash: hash(accessToken),
          refreshHash: hash(refreshToken),
          expiresAt: new Date(Date.now() + 1800000),
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
      res.cookie('shiv_refresh', result.refreshToken, { ...options, maxAge: 30 * 86400000 });
      return { user: result.user };
    }
    return result;
  }
  @Public()
  @Post('otp/request')
  @Contract(otpRequestSchema)
  request(@Input(otpRequestSchema) body: z.infer<typeof otpRequestSchema>) {
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
    return this.sendSession(await this.auth.verify(body.phone, body.code), req, res);
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
}

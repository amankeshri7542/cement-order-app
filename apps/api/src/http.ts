import {
  ArgumentsHost,
  Body,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  PipeTransform,
  SetMetadata,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { ApiBody } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { canDo, type Access, type Permission } from '@shiv/shared';
import { createHash, timingSafeEqual } from 'node:crypto';

export type AuthRequest = Request & {
  user: User;
  sessionId: string;
  /** Set for a staff app session: the phone it belongs to. */
  staffDevice?: { id: string; userId: string; publicKey: string; status: string } | null;
  sessionAccessHash: string;
  // What this person may do now, worked out from their memberships on every request.
  access: Access;
  // Whose books this person may see: every firm, or the listed ones (a one-firm accountant, or shop
  // staff, who see their own shops' firms).
  firms?: 'ALL' | string[];
  deniedPermission?: string;
  requestId: string;
  rawBody?: Buffer;
};
/**
 * What a signed-in person may see of their own account. The User row also holds the owner's own
 * notes about a customer (tags, area, credit limit, khata balance, how many private notes), which
 * customers must never receive, so no response returns the row itself.
 */
export function accountView(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    language: user.language,
    contractorStatus: user.contractorStatus,
    deletedAt: user.deletedAt,
    ...(user.role === 'ADMIN'
      ? { staffTitle: user.staffTitle, whatsappAlerts: user.whatsappAlerts }
      : {}),
  };
}
export const Public = () => SetMetadata('public', true);
/** A signed-in person acting on their own records only. The handler must filter by req.user.id. */
export const Self = () => SetMetadata('self', true);
/**
 * How a route keeps to the firms a person may see (plan v4, two firms). `own`: it filters by firm
 * itself (firmWhere, customerFirmWhere or requireFirm). `shop`: its shop filter does it, because a
 * one-firm person holds shop-by-shop permissions only at that firm's shops. `none`: it reads nothing
 * that belongs to a firm. route-rules.test.ts fails any firm-owned route without one.
 */
export const Firm = (how: 'own' | 'shop' | 'none') => SetMetadata('firm', how);
/** The handler limits its own results to the shops this person holds the permission at. */
export const scoped = 'scoped' as const;
export type ShopLookup = (
  db: {
    order: { findUnique(args: object): Promise<{ locationId: string } | null> };
    quote: { findUnique(args: object): Promise<{ locationId: string } | null> };
    ownerWork: {
      findUnique(args: object): Promise<{
        order: { locationId: string } | null;
        quote: { locationId: string } | null;
      } | null>;
    };
    followUp: { findUnique(args: object): Promise<{ locationId: string } | null> };
  },
  req: AuthRequest,
) => Promise<string | undefined>;
export type CanRule = { permission: Permission; shop?: ShopLookup | typeof scoped };
/**
 * Needs this permission, at the shop the second argument finds. A permission some role holds for
 * only certain shops must say how to find the shop, or a test fails the build.
 */
export const Can = (permission: Permission, shop?: CanRule['shop']) =>
  SetMetadata('can', { permission, shop } satisfies CanRule);
const paramOf = (req: AuthRequest, param: string) => String(req.params[param] ?? '');
export const atOrder =
  (param = 'id'): ShopLookup =>
  async (db, req) =>
    (
      await db.order.findUnique({
        where: { id: paramOf(req, param) },
        select: { locationId: true },
      })
    )?.locationId;
export const atQuote =
  (param = 'id'): ShopLookup =>
  async (db, req) =>
    (
      await db.quote.findUnique({
        where: { id: paramOf(req, param) },
        select: { locationId: true },
      })
    )?.locationId;
export const atFollowUp =
  (param = 'id'): ShopLookup =>
  async (db, req) =>
    (
      await db.followUp.findUnique({
        where: { id: paramOf(req, param) },
        select: { locationId: true },
      })
    )?.locationId;
export const atWork =
  (param = 'id'): ShopLookup =>
  async (db, req) => {
    const work = await db.ownerWork.findUnique({
      where: { id: paramOf(req, param) },
      select: { order: { select: { locationId: true } }, quote: { select: { locationId: true } } },
    });
    return work?.order?.locationId ?? work?.quote?.locationId;
  };
export const MAIN_LOCATION = 'loc_main';
/** Limits a query to this person's shops. Empty for anyone who holds it at every shop. */
export function shopWhere(req: AuthRequest, permission: Permission) {
  const scope = req.access?.[permission];
  return scope && scope !== 'ALL' ? { locationId: { in: scope } } : {};
}
/** One shop if asked for, which must be one of this person's. Otherwise all of theirs. */
export function shopAsked(req: AuthRequest, permission: Permission, asked?: unknown) {
  if (typeof asked !== 'string' || !asked) return shopWhere(req, permission);
  requireAt(req, permission, asked);
  return { locationId: asked };
}
/** The shop an action happens at: the one asked for, or this person's only shop. */
export function shopForAction(req: AuthRequest, permission: Permission, asked?: string) {
  const scope = req.access?.[permission];
  if (!scope) forbid(req, permission);
  if (asked) {
    if (!canDo(req.access, permission, asked)) forbid(req, permission);
    return asked;
  }
  if (scope === 'ALL') return MAIN_LOCATION;
  if (scope.length === 1) return scope[0]!;
  fail('SHOP_REQUIRED', 'Choose which shop this is for.', 400);
}
/** The shop firm-wide money is counted at: the person's own, or the main shop for all-shop roles. */
export function homeShop(req: AuthRequest) {
  const scope = req.access?.['money.receive'];
  return Array.isArray(scope) && scope.length ? [...scope].sort()[0]! : MAIN_LOCATION;
}
/** Refuses unless this person holds the permission at this shop. */
export function requireAt(req: AuthRequest, permission: Permission, locationId?: string) {
  if (!canDo(req.access, permission, locationId)) forbid(req, permission);
}
export function forbid(req: AuthRequest, permission: string): never {
  req.deniedPermission = permission;
  fail('FORBIDDEN', 'You do not have access to this.', 403);
}
export function fail(code: string, message: string, status = 400, details?: unknown): never {
  throw new HttpException({ code, message, ...(details === undefined ? {} : { details }) }, status);
}
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function cookie(req: Request, key: string) {
  return req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}
class SchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success)
      fail(
        'INVALID_INPUT',
        'Check the highlighted fields.',
        400,
        // A huge invalid body (thousands of bad list items) must not produce a huge answer.
        parsed.error.issues
          .slice(0, 20)
          .map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    return parsed.data;
  }
}
export const Input = (schema: z.ZodType) => Body(new SchemaPipe(schema));
export const Contract = (schema: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject });
/** Safe log fields for an unexpected error: its type, Prisma code and model, and stack frames as
 * file:line. Never the message, which can carry a phone number, address or query values. */
export function errorCause(error: unknown) {
  const cause: Record<string, unknown> = {
    errorType: error instanceof Error ? error.constructor.name : 'Unknown',
  };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    cause.prismaCode = error.code;
    const model = (error.meta as { modelName?: unknown } | undefined)?.modelName;
    if (typeof model === 'string') cause.prismaModel = model;
  }
  const frames = (error instanceof Error ? error.stack || '' : '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .map((line) => /\(?(?:file:\/\/)?([^\s()]+):(\d+):\d+\)?$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map(([, file, row]) => `${file!.replace(`${process.cwd()}/`, '')}:${row}`)
    .slice(0, 6);
  if (frames.length) cause.stack = frames;
  return cause;
}

@Catch()
export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<AuthRequest>();
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: Record<string, unknown> = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    };
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
      status = 413;
      body = { code: 'UPLOAD_TOO_LARGE', message: 'The uploaded file or request is too large.' };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const detail = error.getResponse();
      body = typeof detail === 'object' ? { ...detail } : { message: detail };
      // Nest turns unreadable JSON into its own 400 carrying the parser's message (positions,
      // the character it choked on). Every 400 of ours has a code, so one without is Nest's.
      if (status === 400 && !body.code)
        body = {
          code: 'INVALID_BODY',
          message: 'The request could not be read. Please try again.',
        };
      if (!body.code)
        body.code = status === 429 ? 'RATE_LIMITED' : HttpStatus[status] || 'REQUEST_FAILED';
    } else if (
      // body-parser marks the client's own faults (bad JSON or charset, unknown encoding, an
      // aborted body) with a 4xx status and expose: true. Its message is not passed on.
      error &&
      typeof error === 'object' &&
      'expose' in error &&
      error.expose === true &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500
    ) {
      status = error.status;
      body = { code: 'INVALID_BODY', message: 'The request could not be read. Please try again.' };
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        status = 400;
        body = { code: 'INVALID_INPUT', message: 'A linked record does not exist.' };
      }
      if (error.code === 'P2002' || error.code === 'P2034') {
        status = 409;
        body = {
          code: 'CONFLICT',
          message: 'This changed while you were working. Refresh and try again.',
        };
      }
      if (error.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'This record could not be found.' };
      }
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: 'REQUEST_FAILED',
          requestId: req.requestId,
          status,
          code: body.code,
          route: `${req.method} ${(req.route as { path?: string } | undefined)?.path || 'unmatched'}`,
          ...errorCause(error),
          timestamp: new Date().toISOString(),
        }),
      );
    if ([401, 403, 429].includes(status))
      console.warn(
        JSON.stringify({
          event: 'SECURITY_REQUEST_REJECTED',
          requestId: req.requestId,
          status,
          ...(req.deniedPermission ? { permission: req.deniedPermission } : {}),
          timestamp: new Date().toISOString(),
        }),
      );
    res.status(status).json({ error: { ...body, requestId: req.requestId } });
  }
}

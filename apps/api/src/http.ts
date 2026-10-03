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
import { createHash, timingSafeEqual } from 'node:crypto';

export type AuthRequest = Request & {
  user: User;
  sessionId: string;
  requestId: string;
  rawBody?: Buffer;
};
export const Public = () => SetMetadata('public', true);
export const Admin = () => SetMetadata('admin', true);
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
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    return parsed.data;
  }
}
export const Input = (schema: z.ZodType) => Body(new SchemaPipe(schema));
export const Contract = (schema: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject });
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
      if (!body.code)
        body.code = status === 429 ? 'RATE_LIMITED' : HttpStatus[status] || 'REQUEST_FAILED';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          timestamp: new Date().toISOString(),
        }),
      );
    res.status(status).json({ error: { ...body, requestId: req.requestId } });
  }
}

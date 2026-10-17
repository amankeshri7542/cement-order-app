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
  sessionAccessHash: string;
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
          timestamp: new Date().toISOString(),
        }),
      );
    res.status(status).json({ error: { ...body, requestId: req.requestId } });
  }
}

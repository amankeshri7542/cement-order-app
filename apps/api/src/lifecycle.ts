import { BeforeApplicationShutdown, Injectable, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Subject } from 'rxjs';

// Signals long-lived responses (event streams) to finish so the HTTP server can drain.
@Injectable()
export class Lifecycle implements BeforeApplicationShutdown {
  readonly closing = new Subject<void>();
  draining = false;
  stop() {
    if (this.draining) return;
    this.draining = true;
    this.closing.next();
    this.closing.complete();
  }
  beforeApplicationShutdown() {
    this.stop();
  }
}

/**
 * Drain HTTP before Nest's teardown. Nest runs onModuleDestroy (database disconnect, worker
 * timers) before closing the server, so an in-flight checkout could lose its connection.
 * Here new connections stop first, open event streams end, in-flight requests get `drainMs`
 * to finish, and only then the database and workers shut down.
 */
export async function shutdown(app: INestApplication, drainMs = 10_000) {
  app.get(Lifecycle).stop();
  const server = app.getHttpServer() as Server;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      clearInterval(idle);
      server.closeAllConnections();
      resolve();
    }, drainMs);
    timer.unref();
    // Keep-alive sockets become idle as their last response finishes; close them promptly
    // instead of waiting for the keep-alive timeout.
    const idle = setInterval(() => server.closeIdleConnections(), 100);
    idle.unref();
    server.close(() => {
      clearTimeout(timer);
      clearInterval(idle);
      resolve();
    });
    server.closeIdleConnections();
  });
  await app.close();
}

const credentialPattern = /\b(password|passwd|secret|token|apikey|api_key|key|auth)=([^&\s'"`]+)/gi;
// Operator-facing failure text without connection-string credentials or secret values.
export function safeMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
      } catch {
        return '[url]';
      }
    })
    .replace(credentialPattern, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Correlation IDs from a trusted proxy are reused only when they are short opaque tokens.
export function requestId(incoming: unknown, fallback: () => string) {
  return typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)
    ? incoming
    : fallback();
}

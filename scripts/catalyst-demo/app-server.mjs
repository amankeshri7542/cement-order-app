/* global AbortSignal, Headers */
// Hosted-demo server for the customer web export: static files plus a same-origin /api/v1 proxy.
// The host's gateway answers CORS preflights itself, so the browser must never call the API
// cross-origin. Env: PORT, CUSTOMER_DIST, API_PROXY_ORIGIN, EXPO_PUBLIC_API_URL (for the CSP).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import securityHeaders from './web-security.cjs';

const root = resolve(process.env.CUSTOMER_DIST || 'dist');
const api = new URL(process.env.API_PROXY_ORIGIN || '').origin;
const headers = securityHeaders();
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
// Hop-by-hop and length/encoding headers are recomputed by each side of the proxy.
const dropped = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'upgrade',
]);

// The customer app sends JSON only; uploads are owner-desk features and paused in the demo.
const maxBody = 1024 * 1024;

async function proxy(req, res) {
  const forwarded = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    // The Catalyst gateway injects project and account credentials as x-zc-* headers into every
    // request this server receives; they must never travel any further.
    if (!dropped.has(key) && !key.startsWith('x-zc-') && value !== undefined)
      forwarded.set(key, Array.isArray(value) ? value.join(', ') : value);
  // Buffer the (small JSON) body so the gateway gets a Content-Length, not a chunked stream.
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBody) return res.writeHead(413).end();
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  const upstream = await fetch(api + req.url, {
    method: req.method,
    headers: forwarded,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(28000),
  });
  const out = {};
  upstream.headers.forEach((value, key) => {
    if (!dropped.has(key) && key !== 'set-cookie') out[key] = value;
  });
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(upstream.status, out);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function serveStatic(req, res) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${sep}`) && file !== root) return res.writeHead(400).end();
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (extname(pathname)) return res.writeHead(404).end();
    file = resolve(root, 'index.html');
  }
  const bytes = await readFile(file);
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

const server = createServer((req, res) => {
  const handler = req.url.startsWith('/api/v1/') ? proxy : serveStatic;
  handler(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(502).end();
    else res.destroy();
  });
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT || 8081), '0.0.0.0');

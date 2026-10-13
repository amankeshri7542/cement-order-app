import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const api = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').origin;
  const asset = process.env.NEXT_PUBLIC_ASSET_ORIGIN
    ? new URL(process.env.NEXT_PUBLIC_ASSET_ORIGIN).origin
    : '';
  if (!dev && (!api.startsWith('https:') || (asset && !asset.startsWith('https:'))))
    throw new Error('Production frontend origins require HTTPS');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data: ${api} ${asset}; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ${api}${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'${dev ? '' : '; upgrade-insecure-requests'}`;
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('Cache-Control', 'no-store');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

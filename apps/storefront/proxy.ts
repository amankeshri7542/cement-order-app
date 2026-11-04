import { NextRequest, NextResponse } from 'next/server';
import { languageHeader } from './lib/site';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const api = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').origin;
  const asset = process.env.NEXT_PUBLIC_ASSET_ORIGIN
    ? new URL(process.env.NEXT_PUBLIC_ASSET_ORIGIN).origin
    : '';
  if (!dev && (!api.startsWith('https:') || (asset && !asset.startsWith('https:'))))
    throw new Error('Production frontend origins require HTTPS');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' ${asset}; font-src 'self'; connect-src 'self' ${api}${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'${dev ? '' : '; upgrade-insecure-requests'}`;
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  // ?lang=hi or ?lang=en chooses the page's language (lib/language.ts). Only this proxy sets it.
  headers.delete(languageHeader);
  const lang = request.nextUrl.searchParams.get('lang');
  if (lang === 'hi' || lang === 'en') headers.set(languageHeader, lang);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), payment=()',
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Shiv-App', 'storefront');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

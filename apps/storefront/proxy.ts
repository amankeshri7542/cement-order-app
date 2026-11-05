import { NextRequest, NextResponse } from 'next/server';
import { siteSlug } from './lib/materials';

// Addresses of the old pages that have one new home. Query strings are handled below.
const moved: Record<string, string> = { '/cart': '/list', '/products': '/materials' };
// The buying pages hold private answers; every public page is the same for everybody.
const privatePath = /^\/(list|checkout|account|orders|quotes|compare|delete-account)(\/|$)/;

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // //evil.example is an address on another site once it reaches a Location header, so a path never
  // starts with two slashes here. Nothing this site serves is at such an address.
  if (url.pathname.startsWith('//')) {
    const clean = url.clone();
    clean.pathname = `/${url.pathname.replace(/^\/+/, '')}`;
    return NextResponse.redirect(clean, 308);
  }
  // The website has one language now. Old Hindi addresses land on the same page in English, with
  // the rest of the address kept. Never a 302, a script or a noindex: Google must see the move.
  if (url.searchParams.has('lang')) {
    const clean = url.clone();
    clean.searchParams.delete('lang');
    return NextResponse.redirect(clean, 308);
  }
  if (url.pathname === '/hi' || url.pathname.startsWith('/hi/')) {
    const clean = url.clone();
    clean.pathname = `/${url.pathname.slice(3).replace(/^\/+/, '')}`;
    return NextResponse.redirect(clean, 308);
  }
  if (moved[url.pathname]) {
    const clean = url.clone();
    clean.pathname = moved[url.pathname]!;
    // /products?category=steel has a real page now: /materials/sariya.
    const category = url.pathname === '/products' ? url.searchParams.get('category') : null;
    if (category && /^[a-z0-9-]{1,60}$/.test(category)) {
      clean.pathname = `/materials/${siteSlug(category)}`;
      clean.searchParams.delete('category');
    }
    return NextResponse.redirect(clean, 308);
  }

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
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), payment=()',
  );
  // no-store blocks the back-forward cache and belongs on sensitive pages only.
  response.headers.set(
    'Cache-Control',
    privatePath.test(url.pathname) ? 'no-store' : 'private, no-cache',
  );
  response.headers.set('X-Shiv-App', 'storefront');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image|robots.txt|sitemap.xml|api/).*)',
  ],
};

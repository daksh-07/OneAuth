import { NextResponse, type NextRequest } from 'next/server';
import { parseOrigins } from './lib/origins';

/** Per-request nonce Content-Security-Policy. */
export function proxy(request: NextRequest) {
  // Passkeys are bound to one hostname. Send page visits on any other hostname
  // (e.g. a per-deployment Vercel URL) to the configured canonical origin.
  const origins = parseOrigins(process.env.ONEAUTH_ORIGINS);
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '');
  const here = host ? `${proto}://${host}` : request.nextUrl.origin;
  if (
    origins.length > 0 &&
    !origins.includes(here) &&
    (request.method === 'GET' || request.method === 'HEAD') &&
    !request.nextUrl.pathname.startsWith('/api/') &&
    !(process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here))
  ) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, origins[0]);
    // Built by hand: NextResponse.redirect() may relativise a Location that matches
    // the server's own idea of its origin, which would loop on the wrong host.
    return new NextResponse(null, { status: 307, headers: { location: target.toString(), 'cache-control': 'no-store' } });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const isHttps = request.nextUrl.protocol === 'https:';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes (used by accessible primitives) can't carry a nonce.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

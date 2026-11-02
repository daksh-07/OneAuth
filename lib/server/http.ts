import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { trustedOrigin } from './env';
import { UserFacingError } from './errors';
import { RateLimitError } from './ratelimit';
import { BackendNotConfiguredError } from './db';

/**
 * Wraps a JSON route handler: enforces an allow-listed Origin on every
 * request (CSRF + WebAuthn origin binding) and maps errors to safe responses.
 */
export function jsonRoute(handler: (req: NextRequest, origin: string) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const origin = trustedOrigin(req.headers.get('origin'));
    if (!origin) return NextResponse.json({ error: 'origin_not_allowed', message: 'Request origin not allowed.' }, { status: 403 });
    try {
      const body = await handler(req, origin);
      return NextResponse.json(body ?? { ok: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof UserFacingError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many attempts. Please wait a moment and try again.' },
      { status: 429, headers: { 'retry-after': String(err.retryAfterSeconds) } },
    );
  }
  if (err instanceof BackendNotConfiguredError) {
    return NextResponse.json({ error: 'backend_unavailable', message: 'OneAuth’s backend isn’t configured on this deployment.' }, { status: 503 });
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled route error', name: (err as Error)?.name, message: (err as Error)?.message }));
  return NextResponse.json({ error: 'internal', message: 'Something went wrong. Please try again.' }, { status: 500 });
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserFacingError('bad_request', 'Invalid request.');
  }
}

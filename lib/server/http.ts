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
export function jsonRoute<C = unknown>(handler: (req: NextRequest, origin: string, context: C) => Promise<unknown>) {
  return async (req: NextRequest, context: C) => {
    const origin = trustedOrigin(req.headers.get('origin'));
    if (!origin) return NextResponse.json({ error: 'origin_not_allowed', message: 'Request origin not allowed.' }, { status: 403 });
    try {
      const body = await handler(req, origin, context);
      return NextResponse.json(body ?? { ok: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * For GET handlers that return private data. Browsers don't send Origin on
 * same-origin GETs, so cross-site reads are refused with Fetch Metadata
 * instead (and CORS never grants them). Responses are never cached.
 */
export function readRoute<C = unknown>(handler: (req: NextRequest, context: C) => Promise<unknown>) {
  return async (req: NextRequest, context: C) => {
    if (!sameSiteRead(req)) return NextResponse.json({ error: 'origin_not_allowed', message: 'Request origin not allowed.' }, { status: 403 });
    try {
      const body = await handler(req, context);
      if (body instanceof Uint8Array) {
        return new NextResponse(body as Uint8Array<ArrayBuffer>, {
          headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-length': String(body.length) },
        });
      }
      return NextResponse.json(body ?? { ok: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

function sameSiteRead(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  return !origin || trustedOrigin(origin) !== null;
}

/** Reads a binary request body of at most `max` bytes without buffering more than that. */
export async function readBytes(req: NextRequest, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new UserFacingError('too_large', 'That part is too large.', 413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new UserFacingError('too_large', 'That part is too large.', 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
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

import 'server-only';
import { isIP } from 'node:net';
import { cookies, headers } from 'next/headers';
import { isProduction } from './env';
import type { RequestContext } from './events';

export const COOKIE = {
  session: isProduction ? '__Host-oa_session' : 'oa_session',
  device: isProduction ? '__Host-oa_device' : 'oa_device',
  pairing: isProduction ? '__Host-oa_pair' : 'oa_pair',
  theme: 'oa_theme',
} as const;

function clientIp(h: Headers): string | null {
  const candidate = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return candidate && isIP(candidate) ? candidate : null;
}

export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent') };
}

const base = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(COOKIE.session, token, { ...base, expires: expiresAt });
}

export async function setDeviceCookie(deviceKey: string) {
  (await cookies()).set(COOKIE.device, deviceKey, { ...base, maxAge: 400 * 24 * 60 * 60 });
}

export async function clearCookie(name: string) {
  (await cookies()).set(name, '', { ...base, maxAge: 0 });
}

export async function readCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

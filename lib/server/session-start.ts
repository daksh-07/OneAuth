import 'server-only';
import { COOKIE, readCookie, setDeviceCookie, setSessionCookie } from './request';
import { revokeSessionByToken } from './sessions';

export async function currentDeviceKey(): Promise<string | null> {
  return (await readCookie(COOKIE.device)) ?? null;
}

/**
 * Persists a freshly created session and (possibly rotated) device key in
 * HttpOnly cookies. Any session this browser already held is revoked, so a
 * replaced cookie never leaves a live session behind.
 */
export async function persistSession(s: { token: string; expiresAt: Date; deviceKey: string; shared: boolean }) {
  const previous = await readCookie(COOKIE.session);
  if (previous && previous !== s.token) await revokeSessionByToken(previous, 'replaced');
  await setSessionCookie(s.token, s.expiresAt, !s.shared);
  await setDeviceCookie(s.deviceKey, !s.shared);
}

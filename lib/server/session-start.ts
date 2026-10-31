import 'server-only';
import { COOKIE, readCookie, setDeviceCookie, setSessionCookie } from './request';

export async function currentDeviceKey(): Promise<string | null> {
  return (await readCookie(COOKIE.device)) ?? null;
}

/** Persists a freshly created session and (possibly rotated) device key in HttpOnly cookies. */
export async function persistSession(s: { token: string; expiresAt: Date; deviceKey: string }) {
  await setSessionCookie(s.token, s.expiresAt);
  await setDeviceCookie(s.deviceKey);
}

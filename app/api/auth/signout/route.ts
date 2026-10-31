import { jsonRoute } from '@/lib/server/http';
import { recordEvent } from '@/lib/server/events';
import { clearCookie, COOKIE, readCookie, requestContext } from '@/lib/server/request';
import { revokeSessionByToken } from '@/lib/server/sessions';

export const POST = jsonRoute(async () => {
  const token = await readCookie(COOKIE.session);
  if (token) {
    const s = await revokeSessionByToken(token, 'signout');
    if (s) await recordEvent({ type: 'auth.signout', userId: s.user_id, deviceId: s.device_id, sessionId: s.id }, await requestContext());
  }
  await clearCookie(COOKIE.session);
  return { ok: true };
});

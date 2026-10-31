import { jsonRoute } from '@/lib/server/http';
import { COOKIE, readCookie } from '@/lib/server/request';
import { getPairingStatusForRequester } from '@/lib/server/pairing';

export const POST = jsonRoute(async () => {
  const status = await getPairingStatusForRequester(await readCookie(COOKIE.pairing));
  return status ? { status: status.status, expiresAt: status.expiresAt } : { status: 'none' };
});

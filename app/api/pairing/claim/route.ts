import { jsonRoute } from '@/lib/server/http';
import { UserFacingError } from '@/lib/server/errors';
import { clearCookie, COOKIE, readCookie, requestContext } from '@/lib/server/request';
import { currentDeviceKey, persistSession } from '@/lib/server/session-start';
import { claimPairing } from '@/lib/server/pairing';

export const POST = jsonRoute(async () => {
  const secret = await readCookie(COOKIE.pairing);
  if (!secret) throw new UserFacingError('not_claimable', 'This connection request is no longer valid.', 409);
  const result = await claimPairing(secret, await currentDeviceKey(), await requestContext());
  await persistSession(result);
  await clearCookie(COOKIE.pairing);
  // Shown on the requesting screen so the user can spot being joined to someone else's account.
  return { ok: true, displayName: result.displayName, kind: result.kind };
});

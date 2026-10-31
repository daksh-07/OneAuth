import { cookies } from 'next/headers';
import { jsonRoute } from '@/lib/server/http';
import { isProduction } from '@/lib/server/env';
import { COOKIE, requestContext } from '@/lib/server/request';
import { createPairingRequest, PAIRING_TTL } from '@/lib/server/pairing';

/** Called by the device that wants access. The secret never leaves its HttpOnly cookie. */
export const POST = jsonRoute(async (_req, origin) => {
  const req = await createPairingRequest(await requestContext());
  (await cookies()).set(COOKIE.pairing, req.secret, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: PAIRING_TTL + 180,
  });
  return { id: req.id, code: req.code, expiresAt: req.expiresAt, approveUrl: `${origin}/pair/${req.id}` };
});

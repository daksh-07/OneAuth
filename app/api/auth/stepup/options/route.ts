import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { beginStepUp } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const session = await requireSession();
  const body = await readJson<{ pairingRequestId?: unknown }>(req);
  const forPairing = typeof body.pairingRequestId === 'string' ? body.pairingRequestId : undefined;
  return beginStepUp(session, origin, forPairing);
});

import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { registerVaultDevice } from '@/lib/server/cloud/vault';

/** Registers this browser's public device key (pending until approved). */
export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:read');
  const body = await readJson<Record<string, unknown>>(req);
  return registerVaultDevice(session, { publicJwk: body.publicJwk }, await requestContext());
});

import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { getRecoveryEnvelope, recoverVaultDevice } from '@/lib/server/cloud/vault';

/** The vault key wrapped under the recovery key: useless without the recovery key itself. */
export const GET = readRoute(async () => getRecoveryEnvelope(await requireSession('cloud:read')));

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const body = await readJson<Record<string, unknown>>(req);
  return recoverVaultDevice(session, { envelope: body.envelope, recoveryProof: body.recoveryProof }, await requestContext());
});

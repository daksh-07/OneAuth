import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { createVault, getVaultState } from '@/lib/server/cloud/vault';

export const GET = readRoute(async () => getVaultState(await requireSession('cloud:read')));

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const body = await readJson<Record<string, unknown>>(req);
  return createVault(
    session,
    { vaultId: body.vaultId, recoveryEnvelope: body.recoveryEnvelope, recoveryProof: body.recoveryProof, publicJwk: body.publicJwk, envelope: body.envelope },
    await requestContext(),
  );
});

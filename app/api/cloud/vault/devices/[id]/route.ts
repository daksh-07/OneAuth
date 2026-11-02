import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { approveVaultDevice, revokeVaultDevice } from '@/lib/server/cloud/vault';

type Ctx = { params: Promise<{ id: string }> };

/** Approve a pending browser: body carries the vault key wrapped to its key and the fingerprint the user compared. */
export const POST = jsonRoute<Ctx>(async (req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  const body = await readJson<Record<string, unknown>>(req);
  return approveVaultDevice(session, (await params).id, { envelope: body.envelope, fingerprint: body.fingerprint }, await requestContext());
});

export const DELETE = jsonRoute<Ctx>(async (_req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  return revokeVaultDevice(session, (await params).id, await requestContext());
});

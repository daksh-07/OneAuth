import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { abortRotation, rotationStatus, startRotation } from '@/lib/server/cloud/rotation';

export const GET = readRoute(async () => rotationStatus(await requireSession('cloud:read')));

/** Starts replacing the vault key (docs/cloud/key-rotation.md §3). */
export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return startRotation(
    session,
    {
      reason: b.reason,
      envelopes: b.envelopes,
      recoveryEnvelope: b.recoveryEnvelope,
      recoveryProof: b.recoveryProof,
      keyVersion: b.keyVersion,
      transitionProof: b.transitionProof,
      keepRecovery: b.keepRecovery,
    },
    await requestContext(),
  );
});

/** Abandons an unfinished replacement; the current keys stay in force. */
export const DELETE = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return abortRotation(session, { rotationId: b.rotationId }, await requestContext());
});

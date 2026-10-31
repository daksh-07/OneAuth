import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { finishStepUp } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const session = await requireSession();
  const body = await readJson<{ challengeId?: string; response?: AuthenticationResponseJSON }>(req);
  await finishStepUp(
    session,
    { challengeId: String(body.challengeId ?? ''), response: body.response as AuthenticationResponseJSON, origin },
    await requestContext(),
  );
  return { ok: true };
});

import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { finishAddPasskey } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const session = await requireSession('security:manage');
  const body = await readJson<{ challengeId?: string; response?: RegistrationResponseJSON; nickname?: string }>(req);
  await finishAddPasskey(
    session,
    {
      challengeId: String(body.challengeId ?? ''),
      response: body.response as RegistrationResponseJSON,
      origin,
      nickname: String(body.nickname ?? ''),
    },
    await requestContext(),
  );
  return { ok: true };
});

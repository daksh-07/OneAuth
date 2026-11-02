import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { currentDeviceKey, persistSession } from '@/lib/server/session-start';
import { finishRegistration } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const body = await readJson<{ challengeId?: string; response?: RegistrationResponseJSON; shared?: boolean }>(req);
  const result = await finishRegistration(
    {
      challengeId: String(body.challengeId ?? ''),
      response: body.response as RegistrationResponseJSON,
      origin,
      device: { deviceKey: await currentDeviceKey(), kind: body.shared ? 'shared' : 'owned' },
    },
    await requestContext(),
  );
  await persistSession({ ...result, shared: body.shared === true });
  return { ok: true };
});

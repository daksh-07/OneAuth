import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { currentDeviceKey, persistSession } from '@/lib/server/session-start';
import { finishLogin } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const body = await readJson<{ challengeId?: string; response?: AuthenticationResponseJSON; shared?: boolean }>(req);
  const result = await finishLogin(
    {
      challengeId: String(body.challengeId ?? ''),
      response: body.response as AuthenticationResponseJSON,
      origin,
      device: { deviceKey: await currentDeviceKey(), kind: body.shared ? 'shared' : 'owned' },
    },
    await requestContext(),
  );
  await persistSession({ ...result, shared: body.shared === true });
  return { ok: true };
});

import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { beginRegistration } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (req, origin) => {
  const body = await readJson<{ displayName?: unknown }>(req);
  return beginRegistration({ displayName: String(body.displayName ?? ''), origin }, await requestContext());
});

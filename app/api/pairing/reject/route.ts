import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { rejectPairing } from '@/lib/server/pairing';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('devices:manage');
  const body = await readJson<{ requestId?: string }>(req);
  return { ok: await rejectPairing(session, String(body.requestId ?? ''), await requestContext()) };
});

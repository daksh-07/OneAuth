import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { commitRotation } from '@/lib/server/cloud/rotation';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return commitRotation(session, { rotationId: b.rotationId }, await requestContext());
});

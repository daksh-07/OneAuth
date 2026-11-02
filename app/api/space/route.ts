import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { createSpace, listSpaces } from '@/lib/server/space';

export const GET = readRoute(async () => listSpaces(await requireSession('space:read')));

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('space:write');
  const b = await readJson<Record<string, unknown>>(req);
  return createSpace(session, { name: b.name, kind: b.kind });
});

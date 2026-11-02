import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { selectSpace } from '@/lib/server/space';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('space:read');
  const b = await readJson<Record<string, unknown>>(req);
  return selectSpace(session, b.spaceId);
});

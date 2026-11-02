import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { listPins, pinItem } from '@/lib/server/space';

type Ctx = { params: Promise<{ id: string }> };

export const GET = readRoute<Ctx>(async (_req, { params }) => listPins(await requireSession('space:read'), (await params).id));

export const POST = jsonRoute<Ctx>(async (req, _o, { params }) => {
  const session = await requireSession('space:write');
  const b = await readJson<Record<string, unknown>>(req);
  return pinItem(session, (await params).id, { fileId: b.fileId, folderId: b.folderId });
});

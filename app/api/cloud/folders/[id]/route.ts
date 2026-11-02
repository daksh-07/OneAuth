import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { deleteFolder, updateFolder } from '@/lib/server/cloud/items';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = jsonRoute<Ctx>(async (req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return updateFolder(session, (await params).id, { encryptedName: b.encryptedName, parentId: b.parentId, trashed: b.trashed });
});

/** Permanently deletes an empty folder. */
export const DELETE = jsonRoute<Ctx>(async (_req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  return deleteFolder(session, (await params).id);
});

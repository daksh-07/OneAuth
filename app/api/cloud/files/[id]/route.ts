import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { deleteFile, updateFile } from '@/lib/server/cloud/items';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = jsonRoute<Ctx>(async (req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return updateFile(session, (await params).id, { encryptedMeta: b.encryptedMeta, folderId: b.folderId, favorite: b.favorite, trashed: b.trashed }, await requestContext());
});

/** Cancels an unfinished upload, or permanently deletes a file. */
export const DELETE = jsonRoute<Ctx>(async (_req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  return deleteFile(session, (await params).id, await requestContext());
});

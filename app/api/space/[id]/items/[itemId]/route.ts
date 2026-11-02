import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { deleteSpaceItem, updateSpaceItem } from '@/lib/server/space';

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = jsonRoute<Ctx>(async (req, _o, { params }) => {
  const session = await requireSession('space:write');
  const { id, itemId } = await params;
  const b = await readJson<Record<string, unknown>>(req);
  return updateSpaceItem(session, id, itemId, { encryptedBody: b.encryptedBody, position: b.position, version: b.version, keyVersion: b.keyVersion });
});

export const DELETE = jsonRoute<Ctx>(async (_req, _o, { params }) => {
  const { id, itemId } = await params;
  return deleteSpaceItem(await requireSession('space:write'), id, itemId);
});

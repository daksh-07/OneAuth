import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { createFolder } from '@/lib/server/cloud/items';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return createFolder(session, { id: b.id, parentId: b.parentId, encryptedName: b.encryptedName, keyVersion: b.keyVersion });
});

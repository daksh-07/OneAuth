import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { submitRotationBatch } from '@/lib/server/cloud/rotation';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const b = await readJson<Record<string, unknown>>(req);
  return submitRotationBatch(session, { rotationId: b.rotationId, files: b.files, folders: b.folders, items: b.items });
});

import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson, readRoute } from '@/lib/server/http';
import { createSpaceItem, listSpaceItems } from '@/lib/server/space';

type Ctx = { params: Promise<{ id: string }> };

/** Encrypted bookmarks and shortcuts; only browsers with vault access get them. */
export const GET = readRoute<Ctx>(async (_req, { params }) => listSpaceItems(await requireSession('space:read'), (await params).id));

export const POST = jsonRoute<Ctx>(async (req, _o, { params }) => {
  const session = await requireSession('space:write');
  const b = await readJson<Record<string, unknown>>(req);
  return createSpaceItem(session, (await params).id, { id: b.id, kind: b.kind, encryptedBody: b.encryptedBody, keyVersion: b.keyVersion });
});

import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { deleteSpace, updateSpace } from '@/lib/server/space';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = jsonRoute<Ctx>(async (req, _o, { params }) => {
  const session = await requireSession('space:write');
  const b = await readJson<Record<string, unknown>>(req);
  return updateSpace(session, (await params).id, { name: b.name, kind: b.kind, accent: b.accent, allDevices: b.allDevices, deviceIds: b.deviceIds });
});

export const DELETE = jsonRoute<Ctx>(async (_req, _o, { params }) => deleteSpace(await requireSession('space:write'), (await params).id));

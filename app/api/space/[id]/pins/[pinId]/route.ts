import { requireSession } from '@/lib/server/auth';
import { jsonRoute } from '@/lib/server/http';
import { unpin } from '@/lib/server/space';

export const DELETE = jsonRoute<{ params: Promise<{ id: string; pinId: string }> }>(async (_req, _o, { params }) => {
  const { id, pinId } = await params;
  return unpin(await requireSession('space:write'), id, pinId);
});

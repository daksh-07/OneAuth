import { requireSession } from '@/lib/server/auth';
import { jsonRoute } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { completeUpload } from '@/lib/server/cloud/items';

export const POST = jsonRoute<{ params: Promise<{ id: string }> }>(async (_req, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  return completeUpload(session, (await params).id, await requestContext());
});

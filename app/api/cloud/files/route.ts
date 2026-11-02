import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { initiateUpload, type InitiateInput } from '@/lib/server/cloud/items';

/** Starts an upload of an already-encrypted object and reserves its size against the quota. */
export const POST = jsonRoute(async (req) => {
  const session = await requireSession('cloud:write');
  const body = await readJson<InitiateInput>(req);
  return initiateUpload(session, body, await requestContext());
});

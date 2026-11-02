import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readJson } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { approvePairing, type ApprovalInput } from '@/lib/server/pairing';

export const POST = jsonRoute(async (req) => {
  const session = await requireSession('devices:manage');
  const body = await readJson<Partial<ApprovalInput>>(req);
  return approvePairing(
    session,
    {
      requestId: String(body.requestId ?? ''),
      confirmedCode: String(body.confirmedCode ?? ''),
      kind: body.kind === 'owned' ? 'owned' : 'shared',
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
      ttlSeconds: Number(body.ttlSeconds),
    },
    await requestContext(),
  );
});

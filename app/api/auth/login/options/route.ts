import { jsonRoute } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { beginLogin } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (_req, origin) => beginLogin({ origin }, await requestContext()));

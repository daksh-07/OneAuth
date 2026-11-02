import { requireSession } from '@/lib/server/auth';
import { jsonRoute } from '@/lib/server/http';
import { beginAddPasskey } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (_req, origin) => beginAddPasskey(await requireSession('security:manage'), origin));

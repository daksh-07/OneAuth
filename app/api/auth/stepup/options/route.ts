import { requireSession } from '@/lib/server/auth';
import { jsonRoute } from '@/lib/server/http';
import { beginStepUp } from '@/lib/server/webauthn';

export const POST = jsonRoute(async (_req, origin) => beginStepUp(await requireSession(), origin));

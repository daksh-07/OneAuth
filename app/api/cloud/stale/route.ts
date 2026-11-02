import { requireSession } from '@/lib/server/auth';
import { readRoute } from '@/lib/server/http';
import { staleContent } from '@/lib/server/cloud/items';

/** Files whose contents were encrypted under an earlier vault key (candidates for re-encryption). */
export const GET = readRoute(async () => staleContent(await requireSession('cloud:read')));

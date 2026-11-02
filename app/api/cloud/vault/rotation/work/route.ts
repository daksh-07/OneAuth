import { requireSession } from '@/lib/server/auth';
import { readRoute } from '@/lib/server/http';
import { rotationWork } from '@/lib/server/cloud/rotation';

export const GET = readRoute(async () => rotationWork(await requireSession('cloud:read')));

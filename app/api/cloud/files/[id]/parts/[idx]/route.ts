import type { NextRequest } from 'next/server';
import { requireSession } from '@/lib/server/auth';
import { jsonRoute, readBytes, readRoute } from '@/lib/server/http';
import { getPart, putPart } from '@/lib/server/cloud/items';
import { PART_SIZE } from '@/lib/server/cloud/storage';

type Ctx = { params: Promise<{ id: string; idx: string }> };

/** One ciphertext transfer part (≤ 1 MiB, well under the platform's request-body limit). */
export const PUT = jsonRoute<Ctx>(async (req: NextRequest, _origin, { params }) => {
  const session = await requireSession('cloud:write');
  const { id, idx } = await params;
  return putPart(session, id, idx, await readBytes(req, PART_SIZE));
});

export const GET = readRoute<Ctx>(async (_req, { params }) => {
  const session = await requireSession('cloud:read');
  const { id, idx } = await params;
  return getPart(session, id, idx);
});

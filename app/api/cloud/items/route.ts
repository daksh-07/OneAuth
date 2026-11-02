import { requireSession } from '@/lib/server/auth';
import { readRoute } from '@/lib/server/http';
import { listItems, type View } from '@/lib/server/cloud/items';

export const GET = readRoute(async (req) => {
  const session = await requireSession('cloud:read');
  const url = new URL(req.url);
  return listItems(session, { folderId: url.searchParams.get('folder') || null, view: (url.searchParams.get('view') ?? 'folder') as View });
});

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/http';
import { requestContext } from '@/lib/server/request';
import { exportAccount } from '@/lib/server/account';

export async function GET() {
  try {
    const session = await requireSession('security:manage');
    const data = await exportAccount(session, await requestContext());
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="oneauth-export-${new Date().toISOString().slice(0, 10)}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

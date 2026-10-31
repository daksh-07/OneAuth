import { NextResponse } from 'next/server';
import { isBackendConfigured } from '@/lib/server/env';
import { one } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Reports whether the database is reachable. Exposes no configuration values. */
export async function GET() {
  if (!isBackendConfigured()) return NextResponse.json({ status: 'degraded', database: 'not_configured' }, { status: 503 });
  try {
    await one('select 1');
    return NextResponse.json({ status: 'ok', database: 'ok' });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}

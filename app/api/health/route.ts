import { NextResponse } from 'next/server';
import { configuredOrigins, isBackendConfigured } from '@/lib/server/env';
import { one } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Reports whether the database is reachable. Exposes no configuration values. */
export async function GET() {
  const origins = configuredOrigins().length > 0 ? 'configured' : 'not_configured';
  if (!isBackendConfigured()) return NextResponse.json({ status: 'degraded', database: 'not_configured', origins }, { status: 503 });
  try {
    const migrated = await one<{ exists: boolean }>(`select to_regclass('public.schema_migrations') is not null as exists`);
    if (!migrated?.exists) return NextResponse.json({ status: 'degraded', database: 'not_migrated', origins }, { status: 503 });
    const row = await one<{ n: number }>('select count(*)::int as n from schema_migrations');
    return NextResponse.json(
      { status: origins === 'configured' ? 'ok' : 'degraded', database: 'ok', migrations: row?.n ?? 0, origins },
      { status: origins === 'configured' ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable', origins }, { status: 503 });
  }
}

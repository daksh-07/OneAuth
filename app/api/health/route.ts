import { NextResponse } from 'next/server';
import { configuredOrigins, isBackendConfigured } from '@/lib/server/env';
import { one } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Reports whether the database is reachable. Exposes no configuration values. */
export async function GET() {
  const origins = configuredOrigins().length > 0 ? 'configured' : 'not_configured';
  if (!isBackendConfigured()) return NextResponse.json({ status: 'degraded', database: 'not_configured', origins }, { status: 503 });
  try {
    // The runtime role can't read schema_migrations (by design); check the latest migration's object instead.
    const role = await one<{ least: boolean; migrated: boolean }>(
      `select (r.rolname = 'oneauth_app' and not r.rolsuper and not r.rolbypassrls) as least,
              to_regprocedure('oneauth_resolve_session(bytea)') is not null as migrated
         from pg_roles r where r.rolname = current_user`,
    );
    const runtimeRole = role?.least ? 'least_privilege' : 'owner';
    const ok = origins === 'configured' && Boolean(role?.migrated);
    return NextResponse.json(
      { status: ok ? 'ok' : 'degraded', database: 'ok', schema: role?.migrated ? 'current' : 'outdated', runtime_role: runtimeRole, origins },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable', origins }, { status: 503 });
  }
}

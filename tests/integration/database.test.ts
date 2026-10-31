import { describe, expect, it } from 'vitest';
import { query } from '@/lib/server/db';

describe('database hardening', () => {
  it('enables row level security on every application table', async () => {
    const rows = await query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('grants nothing to PUBLIC on application tables', async () => {
    const rows = await query(
      `select table_name from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema = 'public'`,
    );
    expect(rows).toEqual([]);
  });
});

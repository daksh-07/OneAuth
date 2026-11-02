/**
 * Owner-level database access for test setup and assertions. Application code
 * under test connects as the least-privilege `oneauth_app` role instead.
 */
import pg from 'pg';
import { TEST_OWNER_URL } from './db-urls';

const pool = new pg.Pool({ connectionString: TEST_OWNER_URL, max: 2 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

export async function closeAdmin() {
  await pool.end();
}

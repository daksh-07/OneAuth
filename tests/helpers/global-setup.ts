import { execFileSync } from 'node:child_process';
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_test';

/** Rebuilds the test database schema from migrations before the run. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  execFileSync('node', ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'inherit' });
}

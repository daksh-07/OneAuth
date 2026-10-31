import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { TEST_APP_PASSWORD, TEST_OWNER_URL } from './db-urls';

export const TEST_DATABASE_URL = TEST_OWNER_URL;

/** Rebuilds the test schema from migrations and provisions the runtime role's login. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_OWNER_URL });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  const env = { ...process.env, DATABASE_URL: TEST_OWNER_URL, ONEAUTH_DB_APP_PASSWORD: TEST_APP_PASSWORD };
  execFileSync('node', ['scripts/migrate.mjs'], { env, stdio: 'inherit' });
  execFileSync('node', ['scripts/provision-app-role.mjs'], { env, stdio: 'inherit' });
}

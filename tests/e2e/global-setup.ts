import { execFileSync } from 'node:child_process';
import pg from 'pg';

export default async function setup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_e2e';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  const env = { ...process.env, DATABASE_URL: url, ONEAUTH_DB_APP_PASSWORD: process.env.E2E_APP_PASSWORD ?? 'local-e2e-app-password-0123456789' };
  execFileSync('node', ['scripts/migrate.mjs'], { env, stdio: 'inherit' });
  execFileSync('node', ['scripts/provision-app-role.mjs'], { env, stdio: 'inherit' });
}

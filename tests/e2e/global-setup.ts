import { execFileSync } from 'node:child_process';
import pg from 'pg';

export default async function setup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_e2e';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  execFileSync('node', ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
}

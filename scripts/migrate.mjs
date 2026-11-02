// Applies db/migrations/*.sql in order, once each, inside a transaction per file.
// Prefers a direct (unpooled) connection: advisory locks need a session.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { pgConfig } from './pg-config.mjs';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const dir = path.join(import.meta.dirname, '..', 'db', 'migrations');
const client = new pg.Client(pgConfig(url));
await client.connect();
try {
  // Serialise concurrent runs (e.g. two preview builds at once).
  await client.query(`select pg_advisory_lock(hashtext('oneauth.migrations'))`);
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('migrations up to date');
} finally {
  await client.end();
}

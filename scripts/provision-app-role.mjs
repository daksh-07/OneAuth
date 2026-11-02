// Gives the least-privilege runtime role (created by migration 0003) a login
// password taken from ONEAUTH_DB_APP_PASSWORD. Runs as the schema owner.
// Neon requires plaintext when changing a role password. Pass it as a bound
// parameter over verified TLS, never interpolate it into a logged statement.
// PostgreSQL/Neon handles the SCRAM storage verifier. Idempotent: each
// run re-syncs the role to the configured value (this is how rotation works).
import pg from 'pg';
import { appRolePassword, pgConfig } from './pg-config.mjs';

async function main() {
  // Derived from the runtime (pooled) owner URL so build and runtime compute the same value.
  const password = appRolePassword(process.env.DATABASE_URL);
  if (!password) {
    throw new Error('App-role password is required to provision the runtime role');
  }
  if (password.length < 24) throw new Error('The app-role password must be at least 24 characters');
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const client = new pg.Client(pgConfig(url));
  await client.connect();
  try {
    await client.query('begin');
    // ALTER ROLE cannot take bind parameters; the transaction-local setting
    // keeps the plaintext out of SQL text and is cleared at commit/rollback.
    await client.query(`select set_config('oneauth.provision_password', $1, true)`, [password]);
    await client.query(`do $$ begin
      execute format('alter role oneauth_app login password %L', current_setting('oneauth.provision_password'));
    end $$`);
    await client.query('commit');
    console.log('[provision] oneauth_app login enabled');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // Never rethrow the raw error: Postgres may echo the statement (and verifier) in it.
    console.error(`[provision] failed (PostgreSQL code ${err.code ?? 'unknown'}); details suppressed to protect credentials`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

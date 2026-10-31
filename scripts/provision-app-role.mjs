// Gives the least-privilege runtime role (created by migration 0003) a login
// password taken from ONEAUTH_DB_APP_PASSWORD. Runs as the schema owner.
// The password is sent only as a SCRAM-SHA-256 verifier computed here, so the
// plaintext never reaches the database server or its logs. Idempotent: each
// run re-syncs the role to the configured value (this is how rotation works).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';
import { appRolePassword, pgConfig } from './pg-config.mjs';

export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function main() {
  // Derived from the runtime (pooled) owner URL so build and runtime compute the same value.
  const password = appRolePassword(process.env.DATABASE_URL);
  if (!password) {
    console.log('[provision] no app-role password configured (ONEAUTH_DB_APP_PASSWORD or ONEAUTH_DB_APP_ROLE=derived); runtime will use the owner role');
    return;
  }
  if (password.length < 24) throw new Error('The app-role password must be at least 24 characters');
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const client = new pg.Client(pgConfig(url));
  await client.connect();
  try {
    await client.query('begin');
    // Passed via a transaction-local setting because ALTER ROLE can't take bind parameters.
    await client.query(`select set_config('oneauth.provision_verifier', $1, true)`, [scramVerifier(password)]);
    await client.query(`do $$ begin
      execute format('alter role oneauth_app login password %L', current_setting('oneauth.provision_verifier'));
    end $$`);
    await client.query('commit');
    console.log('[provision] oneauth_app login enabled with the configured password (SCRAM verifier)');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // Never rethrow the raw error: Postgres may echo the statement (and verifier) in it.
    console.error(`[provision] failed: ${err.code ?? ''} ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

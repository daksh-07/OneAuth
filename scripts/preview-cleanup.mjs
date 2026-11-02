// Preview-only: removes disposable accounts created by the hosted E2E suite
// (display names "Hosted A <run>" / "Hosted B <run>") that a failed run could
// not delete itself. Never runs outside VERCEL_ENV=preview.
import pg from 'pg';
import { pgConfig } from './pg-config.mjs';

if (process.env.VERCEL_ENV !== 'preview') {
  console.log('[preview-cleanup] not a preview build; skipping');
  process.exit(0);
}
const client = new pg.Client(pgConfig(process.env.DATABASE_URL));
await client.connect();
try {
  const { rowCount } = await client.query(
    `delete from users
      where display_name ~ '^Hosted [AB] [0-9a-z]{6,12}$'
        and created_at < now() - interval '30 minutes'`,
  );
  console.log(`[preview-cleanup] removed ${rowCount} disposable hosted-test account(s)`);
} finally {
  await client.end();
}

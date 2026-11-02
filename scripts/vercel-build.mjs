// Vercel build entry point.
// - Preview: apply migrations, then print a credential-free database report.
// - Production: refuse to build against a database unless explicitly opted in,
//   so a mis-scoped integration can never point Production at a preview database.
import { execFileSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;
const hasDb = Boolean(process.env.DATABASE_URL);

if (env === 'production' && hasDb && process.env.ONEAUTH_DATABASE_ENV !== 'production') {
  console.error(
    '[oneauth] Refusing production build: DATABASE_URL is set but ONEAUTH_DATABASE_ENV is not "production". ' +
      'Connect a dedicated production database and set ONEAUTH_DATABASE_ENV=production for the Production environment only.',
  );
  process.exit(1);
}
if (env === 'production' && hasDb && !process.env.ONEAUTH_RUNTIME_DATABASE_URL &&
    !process.env.ONEAUTH_DB_APP_PASSWORD && process.env.ONEAUTH_DB_APP_ROLE !== 'derived') {
  console.error('[oneauth] Refusing production build: restricted runtime database credentials are missing.');
  process.exit(1);
}
if (env === 'production' && process.env.ONEAUTH_RUNTIME_DATABASE_URL &&
    decodeURIComponent(new URL(process.env.ONEAUTH_RUNTIME_DATABASE_URL).username) !== 'oneauth_app') {
  console.error('[oneauth] Refusing production build: runtime connection must use oneauth_app.');
  process.exit(1);
}

if (env === 'preview' && hasDb && process.env.ONEAUTH_SKIP_MIGRATIONS !== '1') {
  console.log('[oneauth] Preview deployment: applying database migrations');
  execFileSync('node', ['scripts/migrate.mjs'], { stdio: 'inherit' });
  execFileSync('node', ['scripts/provision-app-role.mjs'], { stdio: 'inherit' });
  execFileSync('node', ['scripts/preview-cleanup.mjs'], { stdio: 'inherit' });
  execFileSync('node', ['scripts/db-verify.mjs'], { stdio: 'inherit' });
} else {
  console.log(`[oneauth] Skipping migrations (VERCEL_ENV=${env ?? 'unset'}, database ${hasDb ? 'configured' : 'not configured'})`);
}

execFileSync('npx', ['next', 'build'], { stdio: 'inherit' });

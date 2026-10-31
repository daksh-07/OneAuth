// Vercel build entry point. Migrations run automatically for Preview
// deployments only, so database credentials never need to leave Vercel.
// Production migrations stay a deliberate, manual step.
import { execFileSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;
const hasDb = Boolean(process.env.DATABASE_URL);

if (env === 'preview' && hasDb && process.env.ONEAUTH_SKIP_MIGRATIONS !== '1') {
  console.log('[oneauth] Preview deployment: applying database migrations');
  execFileSync('node', ['scripts/migrate.mjs'], { stdio: 'inherit' });
} else {
  console.log(`[oneauth] Skipping migrations (VERCEL_ENV=${env ?? 'unset'}, database ${hasDb ? 'configured' : 'not configured'})`);
}

execFileSync('npx', ['next', 'build'], { stdio: 'inherit' });

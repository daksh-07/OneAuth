import 'server-only';

/**
 * Runtime configuration. Nothing here is a secret: OneAuth's session security
 * comes from random tokens stored hashed in Postgres, not from a signing key.
 */

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}

export function isBackendConfigured(): boolean {
  return Boolean(databaseUrl());
}

export const isProduction = process.env.NODE_ENV === 'production';

/**
 * Origins allowed to perform WebAuthn ceremonies and state-changing requests.
 * ONEAUTH_ORIGINS is a comma-separated list; on Vercel the deployment, branch
 * and production URLs are added automatically.
 */
export function allowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const o of (process.env.ONEAUTH_ORIGINS ?? '').split(',')) {
    const trimmed = o.trim().replace(/\/$/, '');
    if (trimmed) origins.add(trimmed);
  }
  for (const host of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    if (host) origins.add(`https://${host}`);
  }
  if (!isProduction) {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return [...origins];
}

/** Returns the origin if it is allow-listed, otherwise null. */
export function trustedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const normalized = origin.replace(/\/$/, '');
  return allowedOrigins().includes(normalized) ? normalized : null;
}

export function rpIdFor(origin: string): string {
  return new URL(origin).hostname;
}

export const RP_NAME = 'OneAuth';

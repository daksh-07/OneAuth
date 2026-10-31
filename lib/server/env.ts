import 'server-only';
import { parseOrigins } from '../origins';

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
 *
 * Only origins listed explicitly in ONEAUTH_ORIGINS (comma-separated) are
 * trusted; deployment hostnames are never trusted implicitly, because a
 * passkey is bound to the relying-party hostname it was created on. The first
 * entry is the canonical origin. localhost is allowed outside production.
 */
export function allowedOrigins(): string[] {
  const origins = new Set<string>(configuredOrigins());
  if (!isProduction) {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return [...origins];
}

export function configuredOrigins(): string[] {
  return parseOrigins(process.env.ONEAUTH_ORIGINS);
}

/** The origin users should be sent to, if one is configured. */
export function canonicalOrigin(): string | null {
  return configuredOrigins()[0] ?? null;
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

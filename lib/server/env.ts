import 'server-only';
import { createHmac } from 'node:crypto';
import { parseOrigins } from '../origins';

/**
 * Runtime configuration. Nothing here is a secret: OneAuth's session security
 * comes from random tokens stored hashed in Postgres, not from a signing key.
 */

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}

export const APP_DB_ROLE = 'oneauth_app';

/**
 * The connection the application runtime uses. Migrations use the owner
 * connection (scripts/migrate.mjs); the runtime connects as the
 * least-privilege `oneauth_app` role when its password is provisioned:
 * - ONEAUTH_RUNTIME_DATABASE_URL, if set, is used as-is (local/CI);
 * - otherwise, with ONEAUTH_DB_APP_PASSWORD, DATABASE_URL's host and database
 *   are reused with the app role's credentials (works with Neon branches);
 * - otherwise DATABASE_URL (owner). /api/health reports which is in use.
 */
export function runtimeDatabaseUrl(): string | undefined {
  if (process.env.ONEAUTH_RUNTIME_DATABASE_URL) return process.env.ONEAUTH_RUNTIME_DATABASE_URL;
  const base = databaseUrl();
  const password = appRolePassword(base);
  if (!base || !password) return base;
  const url = new URL(base);
  url.username = APP_DB_ROLE;
  url.password = password;
  return url.toString();
}

/**
 * The runtime role's password: explicit (ONEAUTH_DB_APP_PASSWORD), or, with
 * ONEAUTH_DB_APP_ROLE=derived, HMAC-derived from the owner password already in
 * the environment so no person or tool ever handles it. Mirrored in
 * scripts/pg-config.mjs (unit-tested to match).
 */
export function appRolePassword(ownerUrl = databaseUrl()): string | undefined {
  if (process.env.ONEAUTH_DB_APP_PASSWORD) return process.env.ONEAUTH_DB_APP_PASSWORD;
  if (process.env.ONEAUTH_DB_APP_ROLE !== 'derived' || !ownerUrl) return undefined;
  const ownerPassword = decodeURIComponent(new URL(ownerUrl).password);
  if (!ownerPassword) return undefined;
  return createHmac('sha256', ownerPassword).update('oneauth/app-role-password/v1').digest('base64url');
}

export function isBackendConfigured(): boolean {
  return Boolean(runtimeDatabaseUrl());
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

/**
 * WebAuthn relying-party ID for a trusted origin. Defaults to the origin's
 * hostname. ONEAUTH_RP_ID may set a registrable parent domain (e.g. RP ID
 * "oneauth.example" for origin "https://app.oneauth.example") so passkeys stay
 * valid across subdomains; it must equal or be a parent of every origin's host,
 * which is the same rule browsers enforce.
 */
export function rpIdFor(origin: string): string {
  const host = new URL(origin).hostname;
  const configured = process.env.ONEAUTH_RP_ID?.trim().toLowerCase();
  if (!configured) return host;
  if (host === configured || host.endsWith(`.${configured}`)) return configured;
  if (!isProduction && (host === 'localhost' || host === '127.0.0.1')) return host;
  throw new Error(`ONEAUTH_RP_ID "${configured}" is not a parent domain of origin ${origin}`);
}

export const RP_NAME = 'OneAuth';

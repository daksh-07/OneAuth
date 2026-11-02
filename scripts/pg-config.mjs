import { createHmac } from 'node:crypto';
// Shared by the migration runner and (mirrored in) lib/server/db.ts.
// Remote connections always verify the server certificate. Provide
// DATABASE_CA_CERT (PEM) for providers whose certificates chain to a private CA.

const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

export function pgConfig(connectionString, ca = process.env.DATABASE_CA_CERT) {
  const url = new URL(connectionString);
  const local = LOCAL.has(url.hostname);
  // Strip libpq ssl parameters so they can't silently downgrade verification.
  for (const p of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(p);
  return {
    connectionString: url.toString(),
    ssl: local ? undefined : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}

/** Mirrors appRolePassword() in lib/server/env.ts. */
export function appRolePassword(ownerUrl = process.env.DATABASE_URL) {
  if (process.env.ONEAUTH_DB_APP_PASSWORD) return process.env.ONEAUTH_DB_APP_PASSWORD;
  if (process.env.ONEAUTH_DB_APP_ROLE !== 'derived' || !ownerUrl) return undefined;
  const ownerPassword = decodeURIComponent(new URL(ownerUrl).password);
  if (!ownerPassword) return undefined;
  return createHmac('sha256', ownerPassword).update('oneauth/app-role-password/v1').digest('base64url');
}

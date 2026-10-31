import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { runtimeDatabaseUrl } from './env';

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not configured');
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Remote connections always verify the server certificate (mirrors
 * scripts/pg-config.mjs). libpq ssl parameters are stripped so a connection
 * string can't silently downgrade verification.
 */
export function pgConfig(connectionString: string, ca = process.env.DATABASE_CA_CERT): pg.PoolConfig {
  const url = new URL(connectionString);
  for (const p of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(p);
  const local = LOCAL_HOSTS.has(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: local ? undefined : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}

const globalForPool = globalThis as unknown as { __oneauthPool?: pg.Pool };

function pool(): pg.Pool {
  const url = runtimeDatabaseUrl();
  if (!url) throw new BackendNotConfiguredError();
  if (!globalForPool.__oneauthPool) {
    globalForPool.__oneauthPool = new pg.Pool({
      ...pgConfig(url),
      // Serverless: keep few connections per instance and rely on the provider's pooler.
      max: Number(process.env.DATABASE_POOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPool.__oneauthPool;
}

export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * Tenant context. `asUser` opens one transaction, sets the transaction-local
 * `oneauth.user_id` (read by row-level-security policies), and routes every
 * query made inside the callback through that transaction. Because the
 * setting is transaction-local it can't leak to the next user of a pooled
 * connection, including through PgBouncer transaction pooling.
 */
interface TenantScope {
  userId: string;
  client: pg.PoolClient;
}
const tenant = new AsyncLocalStorage<TenantScope>();

export function currentTenant(): string | null {
  return tenant.getStore()?.userId ?? null;
}

export async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const scope = tenant.getStore();
  if (scope) {
    if (scope.userId !== userId) throw new Error('Tenant context mismatch');
    return fn();
  }
  const client = await pool().connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('oneauth.user_id', $1, true)`, [userId]);
    const result = await tenant.run({ userId, client }, fn);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T[]> {
  const res = await (client ?? tenant.getStore()?.client ?? pool()).query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

/** A transaction. Inside `asUser` it joins the tenant transaction. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const scope = tenant.getStore();
  if (scope) return fn(scope.client);
  const client = await pool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await globalForPool.__oneauthPool?.end();
  globalForPool.__oneauthPool = undefined;
}

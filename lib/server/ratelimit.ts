import 'server-only';
import { currentTenant, queryAutonomous } from './db';

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many attempts');
  }
}

/**
 * Fixed-window counter stored in Postgres so limits hold across serverless
 * instances. Throws RateLimitError when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  // Inside a tenant transaction this would need a second pooled connection
  // while holding the first, which can exhaust a small serverless pool.
  if (currentTenant()) throw new Error('rateLimit must be called before opening a tenant scope');
  // Autonomous: the count must survive even if the caller's transaction rolls back.
  const [row] = await queryAutonomous<{ count: number; window_start: Date }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count, window_start`,
    [key, windowSeconds],
  );
  // Opportunistic cleanup (~1% of calls) keeps the table bounded without a cron job.
  if (Math.random() < 0.01) await queryAutonomous(`delete from rate_limits where window_start < now() - interval '1 day'`);
  if (row && row.count > limit) {
    const retry = Math.max(1, Math.ceil((row.window_start.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
    throw new RateLimitError(retry);
  }
}

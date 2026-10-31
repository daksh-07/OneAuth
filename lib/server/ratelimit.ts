import 'server-only';
import { one } from './db';

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
  const row = await one<{ count: number; window_start: Date }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count, window_start`,
    [key, windowSeconds],
  );
  if (row && row.count > limit) {
    const retry = Math.max(1, Math.ceil((row.window_start.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
    throw new RateLimitError(retry);
  }
}

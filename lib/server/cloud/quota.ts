import 'server-only';
import { one, query } from '../db';
import { UserFacingError } from '../errors';
import { planById } from '../../plans';

export interface Usage {
  used: number;
  reserved: number;
  quota: number;
}

/** Must run inside the user's tenant scope. */
export async function usageFor(userId: string): Promise<Usage> {
  const row = await one<{ used: string; reserved: string; plan_id: string | null }>(
    `select coalesce(u.used_bytes, 0) as used, coalesce(u.reserved_bytes, 0) as reserved, s.plan_id
       from users x left join storage_usage u on u.user_id = x.id left join subscriptions s on s.user_id = x.id
      where x.id = $1`,
    [userId],
  );
  return { used: Number(row?.used ?? 0), reserved: Number(row?.reserved ?? 0), quota: planById(row?.plan_id ?? 'free').cloudBytes };
}

/**
 * Reserves `bytes` against the user's entitlement. Locks the usage row, so
 * concurrent uploads are serialised and can never jointly exceed the quota.
 * Must run inside the user's tenant transaction.
 */
export async function reserve(userId: string, bytes: number): Promise<void> {
  await query(`insert into storage_usage (user_id) values ($1) on conflict (user_id) do nothing`, [userId]);
  const row = await one<{ used: string; reserved: string }>(
    `select used_bytes as used, reserved_bytes as reserved from storage_usage where user_id = $1 for update`,
    [userId],
  );
  const { quota } = await usageFor(userId);
  if (Number(row!.used) + Number(row!.reserved) + bytes > quota) {
    throw new UserFacingError('quota_exceeded', 'This file would take you over your storage allowance.', 413);
  }
  await query(`update storage_usage set reserved_bytes = reserved_bytes + $2 where user_id = $1`, [userId, bytes]);
}

export async function settle(userId: string, bytes: number): Promise<void> {
  await query(`update storage_usage set reserved_bytes = reserved_bytes - $2, used_bytes = used_bytes + $2 where user_id = $1`, [userId, bytes]);
}

export async function release(userId: string, bytes: number, from: 'reserved' | 'used'): Promise<void> {
  await query(
    from === 'reserved'
      ? `update storage_usage set reserved_bytes = reserved_bytes - $2 where user_id = $1`
      : `update storage_usage set used_bytes = used_bytes - $2 where user_id = $1`,
    [userId, bytes],
  );
}

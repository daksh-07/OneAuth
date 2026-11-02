import 'server-only';
import { asUser, one, query, type Queryable } from './db';
import { randomToken, sha256 } from './tokens';
import { recordEvent, type RequestContext } from './events';

export interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  kind: 'owned' | 'shared';
  enrolled_via: 'passkey' | 'pairing';
  created_at: Date;
  last_seen_at: Date;
  active_sessions: number;
  access_expires_at: Date | null;
  scopes: string[] | null;
}

/**
 * Finds the device identified by the browser's device key for this user, or
 * enrols a new one. Must run inside the user's tenant scope. A key that is
 * revoked, belongs to another account (invisible under RLS, so the insert
 * conflicts), or was enrolled as a different kind is never reused: a fresh
 * key is issued and the caller must store the returned deviceKey.
 */
export async function findOrCreateDevice(
  d: { userId: string; deviceKey: string | null; name: string; platform: string; kind: 'owned' | 'shared'; via: 'passkey' | 'pairing' },
  ctx: RequestContext,
  client?: Queryable,
): Promise<{ id: string; created: boolean; deviceKey: string }> {
  if (d.deviceKey) {
    const existing = await one<{ id: string; revoked_at: Date | null; kind: string }>(
      `select id, revoked_at, kind from devices where device_key_hash = $1 and user_id = $2`,
      [sha256(d.deviceKey), d.userId],
      client,
    );
    if (existing && !existing.revoked_at && existing.kind === d.kind) {
      return { id: existing.id, created: false, deviceKey: d.deviceKey };
    }
    if (!existing) {
      const inserted = await insertDevice(d, d.deviceKey, ctx, client);
      if (inserted) return inserted;
    }
  }
  const fresh = await insertDevice(d, randomToken(), ctx, client);
  if (!fresh) throw new Error('Could not enrol device');
  return fresh;
}

async function insertDevice(
  d: { userId: string; name: string; platform: string; kind: 'owned' | 'shared'; via: 'passkey' | 'pairing' },
  deviceKey: string,
  ctx: RequestContext,
  client?: Queryable,
) {
  // ON CONFLICT: the key may belong to a device we can't see (another account).
  const row = await one<{ id: string }>(
    `insert into devices (user_id, device_key_hash, name, platform, kind, enrolled_via)
     values ($1, $2, $3, $4, $5, $6) on conflict (device_key_hash) do nothing returning id`,
    [d.userId, sha256(deviceKey), d.name.slice(0, 64), d.platform, d.kind, d.via],
    client,
  );
  if (!row) return null;
  await recordEvent({ type: 'device.enrolled', userId: d.userId, deviceId: row.id, detail: { kind: d.kind, via: d.via } }, ctx, client);
  return { id: row.id, created: true, deviceKey };
}

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  return asUser(userId, () => query<DeviceRow>(
    `select d.id, d.name, d.platform, d.kind, d.enrolled_via, d.created_at, d.last_seen_at,
            count(s.id)::int as active_sessions,
            max(s.expires_at) as access_expires_at,
            (select array_agg(distinct sc) from sessions s2, unnest(s2.scopes) sc
              where s2.device_id = d.id and s2.revoked_at is null and s2.expires_at > now()) as scopes
       from devices d
       left join sessions s on s.device_id = d.id and s.revoked_at is null and s.expires_at > now()
      where d.user_id = $1 and d.revoked_at is null
      group by d.id
      order by d.last_seen_at desc`,
    [userId],
  ));
}

export async function getDevice(userId: string, deviceId: string): Promise<DeviceRow | null> {
  const rows = await listDevices(userId);
  return rows.find((r) => r.id === deviceId) ?? null;
}

/**
 * Revokes a device and every session and grant it holds. Ownership is part of
 * the WHERE clause, so a guessed device ID belonging to someone else is a no-op.
 */
export async function revokeDevice(userId: string, deviceId: string, actorSessionId: string, ctx: RequestContext): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return false;
  return asUser(userId, async () => {
    const dev = await one<{ id: string }>(
      `update devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id`,
      [deviceId, userId],
    );
    if (!dev) return false;
    await query(
      `update sessions set revoked_at = now(), revoke_reason = 'device_revoked' where device_id = $1 and revoked_at is null`,
      [deviceId],
    );
    await query(`update device_grants set revoked_at = now() where device_id = $1 and revoked_at is null`, [deviceId]);
    await recordEvent({ type: 'device.revoked', userId, deviceId, sessionId: actorSessionId }, ctx);
    return true;
  });
}

export async function renameDevice(userId: string, deviceId: string, name: string, ctx: RequestContext): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return false;
  return asUser(userId, async () => {
    const rows = await query(
      `update devices set name = $3 where id = $1 and user_id = $2 and revoked_at is null returning id`,
      [deviceId, userId, name],
    );
    if (rows.length) await recordEvent({ type: 'device.renamed', userId, deviceId }, ctx);
    return rows.length === 1;
  });
}

/** Devices connected by pairing in the last 24 hours (excluding this one): surfaced so an unexpected approval is noticed quickly. */
export function recentlyPaired(devices: DeviceRow[], currentDeviceId: string, now = Date.now()): DeviceRow[] {
  return devices.filter(
    (d) => d.enrolled_via === 'pairing' && d.id !== currentDeviceId && now - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  );
}

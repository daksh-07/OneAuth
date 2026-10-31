import 'server-only';
import { one, query, type Queryable } from './db';
import { randomToken, sha256 } from './tokens';
import type { Scope } from '../scopes';
import type { RequestContext } from './events';

export const PRIMARY_SESSION_TTL = 30 * 24 * 60 * 60; // owned device, passkey sign-in
export const SHARED_SIGNIN_TTL = 8 * 60 * 60; // passkey sign-in on a shared computer
export const IDLE_TIMEOUT = 7 * 24 * 60 * 60;
export const REAUTH_WINDOW = 5 * 60; // step-up verification freshness

export interface SessionRecord {
  id: string;
  user_id: string;
  device_id: string;
  kind: 'primary' | 'paired';
  scopes: Scope[];
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  reauth_at: Date | null;
  display_name: string;
  device_name: string;
  device_kind: 'owned' | 'shared';
}

export async function createSession(
  s: { userId: string; deviceId: string; kind: 'primary' | 'paired'; scopes: Scope[]; ttlSeconds: number; reauth?: boolean },
  ctx: RequestContext,
  client?: Queryable,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomToken();
  const row = await one<{ id: string; expires_at: Date }>(
    `insert into sessions (user_id, device_id, token_hash, kind, scopes, expires_at, reauth_at, ip, user_agent)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), case when $7 then now() end, $8, $9)
     returning id, expires_at`,
    [s.userId, s.deviceId, sha256(token), s.kind, s.scopes, s.ttlSeconds, Boolean(s.reauth), ctx.ip, ctx.userAgent?.slice(0, 512) ?? null],
    client,
  );
  return { token, sessionId: row!.id, expiresAt: row!.expires_at };
}

/**
 * Resolves a raw cookie token to an active session. Rejects revoked, expired,
 * idle, locked-account and revoked-device sessions in one query.
 */
export async function validateSessionToken(token: string | undefined | null): Promise<SessionRecord | null> {
  if (!token || token.length > 128) return null;
  const row = await one<SessionRecord>(
    `update sessions s
        set last_seen_at = now()
       from users u, devices d
      where s.token_hash = $1
        and u.id = s.user_id and d.id = s.device_id
        and s.revoked_at is null
        and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(secs => $2)
        and d.revoked_at is null
        and u.status = 'active'
     returning s.id, s.user_id, s.device_id, s.kind, s.scopes, s.created_at, s.last_seen_at,
               s.expires_at, s.reauth_at, u.display_name, d.name as device_name, d.kind as device_kind`,
    [sha256(token), IDLE_TIMEOUT],
  );
  if (row) {
    // Device last-seen is informational; coarse updates keep writes low.
    await query(
      `update devices set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '1 minute'`,
      [row.device_id],
    );
  }
  return row;
}

export function isRecentlyReauthenticated(session: Pick<SessionRecord, 'reauth_at'>): boolean {
  return Boolean(session.reauth_at && Date.now() - session.reauth_at.getTime() < REAUTH_WINDOW * 1000);
}

export async function markReauthenticated(sessionId: string, client?: Queryable): Promise<void> {
  await query(`update sessions set reauth_at = now() where id = $1`, [sessionId], client);
}

/** Revokes a session only if it belongs to userId. Returns false otherwise. */
export async function revokeSession(userId: string, sessionId: string, reason: string, client?: Queryable): Promise<boolean> {
  const rows = await query(
    `update sessions set revoked_at = now(), revoke_reason = $3
      where id = $1 and user_id = $2 and revoked_at is null returning id`,
    [sessionId, userId, reason],
    client,
  );
  return rows.length === 1;
}

export async function revokeSessionByToken(
  token: string,
  reason: string,
): Promise<{ id: string; user_id: string; device_id: string } | null> {
  return one(
    `update sessions set revoked_at = now(), revoke_reason = $2
      where token_hash = $1 and revoked_at is null
     returning id, user_id, device_id`,
    [sha256(token), reason],
  );
}

export interface SessionListRow {
  id: string;
  device_id: string;
  device_name: string;
  kind: 'primary' | 'paired';
  scopes: Scope[];
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

export async function listActiveSessions(userId: string): Promise<SessionListRow[]> {
  return query<SessionListRow>(
    `select s.id, s.device_id, d.name as device_name, s.kind, s.scopes, s.created_at, s.last_seen_at, s.expires_at
       from sessions s join devices d on d.id = s.device_id
      where s.user_id = $1 and s.revoked_at is null and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(secs => $2) and d.revoked_at is null
      order by s.last_seen_at desc`,
    [userId, IDLE_TIMEOUT],
  );
}

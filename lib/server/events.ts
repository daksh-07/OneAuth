import 'server-only';
import { asUser, query, type Queryable } from './db';

export type SecurityEventType =
  | 'account.created'
  | 'account.deleted'
  | 'auth.signin'
  | 'auth.signin_failed'
  | 'auth.signout'
  | 'auth.stepup'
  | 'passkey.added'
  | 'passkey.removed'
  | 'passkey.renamed'
  | 'session.revoked'
  | 'device.enrolled'
  | 'device.revoked'
  | 'device.renamed'
  | 'pairing.approved'
  | 'pairing.rejected'
  | 'pairing.claimed'
  | 'account.exported'
  | 'cloud.vault_created'
  | 'cloud.device_registered'
  | 'cloud.device_approved'
  | 'cloud.recovery_used'
  | 'cloud.device_revoked'
  | 'cloud.file_uploaded'
  | 'cloud.file_trashed'
  | 'cloud.file_deleted'
  | 'cloud.rotation_started'
  | 'cloud.rotation_aborted'
  | 'cloud.vault_rotated'
  | 'space.updated';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Append-only security log. `detail` must never contain tokens, secrets,
 * challenges or key material.
 */
export async function recordEvent(
  e: {
    type: SecurityEventType;
    userId: string | null;
    deviceId?: string | null;
    sessionId?: string | null;
    detail?: Record<string, unknown>;
  },
  ctx: RequestContext,
  client?: Queryable,
): Promise<void> {
  if (!e.userId) throw new Error('Security events must belong to a user');
  // Joins the caller's tenant transaction when one is open for this user.
  await asUser(e.userId, () => query(
    `insert into security_events (user_id, device_id, session_id, type, detail, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [e.userId, e.deviceId ?? null, e.sessionId ?? null, e.type, e.detail ?? {}, ctx.ip, ctx.userAgent?.slice(0, 512) ?? null],
    client,
  ));
}

export interface SecurityEventRow {
  id: string;
  type: SecurityEventType;
  detail: Record<string, unknown>;
  device_name: string | null;
  created_at: Date;
}

export async function listEvents(userId: string, limit = 50, deviceId?: string): Promise<SecurityEventRow[]> {
  return asUser(userId, () => query<SecurityEventRow>(
    `select e.id::text, e.type, e.detail, d.name as device_name, e.created_at
       from security_events e left join devices d on d.id = e.device_id
      where e.user_id = $1 and ($3::uuid is null or e.device_id = $3)
      order by e.created_at desc, e.id desc
      limit $2`,
    [userId, limit, deviceId ?? null],
  ));
}

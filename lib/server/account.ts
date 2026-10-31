import 'server-only';
import { one, query, tx } from './db';
import { UserFacingError } from './errors';
import { listEvents, recordEvent, type RequestContext } from './events';
import { listDevices } from './devices';
import { isRecentlyReauthenticated, listActiveSessions, type SessionRecord } from './sessions';

export interface PasskeyRow {
  id: string;
  nickname: string;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  return query<PasskeyRow>(
    `select id, nickname, device_type, backed_up, created_at, last_used_at
       from authenticators where user_id = $1 order by created_at`,
    [userId],
  );
}

export async function getAccount(userId: string) {
  return one<{ display_name: string; created_at: Date; plan_id: string; primary_use: string | null; onboarded_at: Date | null }>(
    `select u.display_name, u.created_at, coalesce(s.plan_id, 'free') as plan_id, p.primary_use, p.onboarded_at
       from users u left join subscriptions s on s.user_id = u.id left join user_profiles p on p.user_id = u.id
      where u.id = $1`,
    [userId],
  );
}

export async function updateDisplayName(userId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 64) throw new UserFacingError('invalid_name', 'Enter a name between 1 and 64 characters.');
  await query(`update users set display_name = $2, updated_at = now() where id = $1`, [userId, trimmed]);
}

const USES = ['files', 'devices', 'temporary', 'explore'] as const;
export async function setPrimaryUse(userId: string, use: string) {
  if (!(USES as readonly string[]).includes(use)) throw new UserFacingError('invalid', 'Choose one of the options.');
  await query(
    `update user_profiles set primary_use = $2, onboarded_at = coalesce(onboarded_at, now()), updated_at = now() where user_id = $1`,
    [userId, use],
  );
}

export async function renamePasskey(userId: string, id: string, nickname: string, ctx: RequestContext) {
  const trimmed = nickname.trim();
  if (trimmed.length < 1 || trimmed.length > 48) throw new UserFacingError('invalid_name', 'Enter a name between 1 and 48 characters.');
  const rows = await query(`update authenticators set nickname = $3 where id = $1 and user_id = $2 returning id`, [id, userId, trimmed]);
  if (rows.length) await recordEvent({ type: 'passkey.renamed', userId }, ctx);
  return rows.length === 1;
}

/** Everything OneAuth stores about the user, minus secrets and key material. */
export async function exportAccount(session: SessionRecord, ctx: RequestContext) {
  const userId = session.user_id;
  const [account, passkeys, devices, sessions, events] = await Promise.all([
    getAccount(userId),
    listPasskeys(userId),
    listDevices(userId),
    listActiveSessions(userId),
    listEvents(userId, 1000),
  ]);
  await recordEvent({ type: 'account.exported', userId, deviceId: session.device_id, sessionId: session.id }, ctx);
  return { exportedAt: new Date().toISOString(), format: 'oneauth-export/1', account, passkeys, devices, sessions, securityEvents: events };
}

export async function deleteAccount(session: SessionRecord, confirmation: string) {
  if (!isRecentlyReauthenticated(session)) throw new UserFacingError('reauth_required', 'Confirm it’s you with your passkey first.', 403);
  if (confirmation.trim().toLowerCase() !== 'delete my account') {
    throw new UserFacingError('confirmation', 'Type “delete my account” to confirm.');
  }
  // Cascades remove passkeys, devices, sessions, grants, challenges and security events.
  await tx(async (c) => {
    await c.query(`delete from device_pairing_requests where approver_user_id = $1`, [session.user_id]);
    await c.query(`delete from users where id = $1`, [session.user_id]);
  });
}

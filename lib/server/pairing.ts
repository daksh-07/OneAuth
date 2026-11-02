import 'server-only';
import { asUser, one, query, tx } from './db';
import { UserFacingError } from './errors';
import { recordEvent, type RequestContext } from './events';
import { findOrCreateDevice } from './devices';
import { randomInt } from 'node:crypto';
import { createSession, type SessionRecord } from './sessions';
import { rateLimit } from './ratelimit';
import { normalizeUserCode, randomToken, sha256, userCode } from './tokens';
import { GRANT_DURATIONS, GRANTABLE_SCOPES, hasScope, isScope, type Scope } from '../scopes';
import { describeUserAgent } from '../ua';

export const PAIRING_TTL = 5 * 60;
/** After approval, the requesting device has this long to collect its session. */
export const CLAIM_WINDOW = 2 * 60;

export type PairingStatus = 'pending' | 'approved' | 'rejected' | 'claimed' | 'expired';

interface PairingRow {
  id: string;
  user_code: string;
  requested_name: string;
  platform: string;
  ip: string | null;
  status: Exclude<PairingStatus, 'expired'>;
  created_at: Date;
  expires_at: Date;
  grant_kind: 'owned' | 'shared' | null;
  grant_scopes: Scope[] | null;
  grant_ttl_seconds: number | null;
}

function effectiveStatus(row: Pick<PairingRow, 'status' | 'expires_at'>): PairingStatus {
  if ((row.status === 'pending' || row.status === 'approved') && row.expires_at.getTime() <= Date.now()) return 'expired';
  return row.status;
}

// ---------------------------------------------------------------- requesting device

export async function createPairingRequest(ctx: RequestContext) {
  await rateLimit(`pair-create:${ctx.ip ?? 'unknown'}`, 20, 10 * 60);
  const secret = randomToken();
  const { name, platform } = describeUserAgent(ctx.userAgent);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = userCode();
    const row = await one<{ id: string; expires_at: Date }>(
      `insert into device_pairing_requests (secret_hash, user_code, requested_name, platform, user_agent, ip, expires_at)
       select $1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7)
        where not exists (select 1 from device_pairing_requests where user_code = $2 and expires_at > now())
       returning id, expires_at`,
      [sha256(secret), code, name, platform, ctx.userAgent?.slice(0, 512) ?? null, ctx.ip, PAIRING_TTL],
    );
    if (row) return { id: row.id, code, secret, expiresAt: row.expires_at };
  }
  throw new Error('Could not allocate a pairing code');
}

interface ResolvedPairing {
  id: string;
  user_code: string;
  status: Exclude<PairingStatus, 'expired'>;
  expires_at: Date;
  approver_user_id: string | null;
}

/** The requesting device holds only the secret; resolve it without a tenant (SECURITY DEFINER). */
async function resolveBySecret(secret: string): Promise<ResolvedPairing | null> {
  return one<ResolvedPairing>(`select * from oneauth_resolve_pairing($1)`, [sha256(secret)]);
}

export async function getPairingStatusForRequester(secret: string | undefined) {
  if (!secret) return null;
  const row = await resolveBySecret(secret);
  if (!row) return null;
  return { id: row.id, code: row.user_code, status: effectiveStatus(row), expiresAt: row.expires_at };
}

/**
 * Exchanges an approved request for a device session. The conditional UPDATE
 * makes this single-use: a replayed or concurrent claim matches zero rows.
 */
export async function claimPairing(secret: string, deviceKey: string | null, ctx: RequestContext) {
  await rateLimit(`pair-claim:${ctx.ip ?? 'unknown'}`, 30, 10 * 60);
  const resolved = await resolveBySecret(secret);
  const notClaimable = new UserFacingError('not_claimable', 'This connection request is no longer valid.', 409);
  if (!resolved?.approver_user_id || effectiveStatus(resolved) !== 'approved') throw notClaimable;
  // Everything below runs in the approver's tenant scope.
  return asUser(resolved.approver_user_id, () => tx(async (c) => {
    const req = await one<PairingRow & { approver_user_id: string }>(
      `update device_pairing_requests set status = 'claimed', claimed_at = now()
        where secret_hash = $1 and status = 'approved' and expires_at > now()
       returning id, requested_name, platform, grant_kind, grant_scopes, grant_ttl_seconds, approver_user_id`,
      [sha256(secret)],
      c,
    );
    if (!req) throw notClaimable;
    const userId = req.approver_user_id;
    const kind = req.grant_kind!;
    const dev = await findOrCreateDevice(
      { userId, deviceKey, name: req.requested_name, platform: req.platform, kind, via: 'pairing' },
      ctx,
      c,
    );
    const session = await createSession(
      { userId, deviceId: dev.id, kind: 'paired', scopes: req.grant_scopes!, ttlSeconds: req.grant_ttl_seconds! },
      ctx,
      c,
    );
    await query(
      `insert into device_grants (user_id, device_id, pairing_request_id, scopes, expires_at) values ($1, $2, $3, $4, $5)`,
      [userId, dev.id, req.id, req.grant_scopes, session.expiresAt],
      c,
    );
    await query(`update device_pairing_requests set claimed_session_id = $2 where id = $1`, [req.id, session.sessionId], c);
    await recordEvent(
      { type: 'pairing.claimed', userId, deviceId: dev.id, sessionId: session.sessionId, detail: { kind, scopes: req.grant_scopes } },
      ctx,
      c,
    );
    const owner = await one<{ display_name: string }>(`select display_name from users where id = $1`, [userId], c);
    return { ...session, deviceKey: dev.deviceKey, displayName: owner!.display_name, kind };
  }));
}

// ---------------------------------------------------------------- approving device

function assertCanApprove(session: SessionRecord) {
  if (session.kind !== 'primary' || session.device_kind !== 'owned' || !hasScope(session.scopes, 'devices:manage')) {
    throw new UserFacingError(
      'forbidden',
      'Approve new devices from a device you signed in to with your passkey.',
      403,
    );
  }
}

/** Same IPv4 address, or same IPv6 /64. A signal for the user, not a security control. */
function sameNetwork(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  if (a.includes(':') && b.includes(':')) return a.split(':').slice(0, 4).join(':') === b.split(':').slice(0, 4).join(':');
  return a === b;
}

export interface PairingForApprover {
  id: string;
  requestedName: string;
  platform: string;
  createdAt: Date;
  expiresAt: Date;
  status: PairingStatus;
  sameNetwork: boolean | null;
  /** Three codes, one correct, in random order. The user picks the one on the other screen. */
  codeChoices: string[] | null;
  /**
   * True when the requester is not on the approver's network (or it can't be
   * told). Remote relays look like this, so the user must type the code, and
   * the server limits what can be granted (see approvePairing).
   */
  requireTypedCode: boolean;
}

/** What a request from a different (or unknown) network may be granted. */
export const REMOTE_LIMITS = { forbiddenScopes: ['devices:manage'] as string[], maxOwnedTtl: 7 * 24 * 60 * 60 };

async function lookupPairingForApproverInScope(
  session: SessionRecord,
  ref: { id: string } | { code: string },
  ctx: RequestContext,
): Promise<PairingForApprover | null> {
  assertCanApprove(session);
  let row: PairingRow | null = null;
  if ('id' in ref) {
    if (!/^[0-9a-f-]{36}$/i.test(ref.id)) return null;
    row = await one<PairingRow>(
      `select id, user_code, requested_name, platform, host(ip) as ip, status, created_at, expires_at,
              grant_kind, grant_scopes, grant_ttl_seconds
         from device_pairing_requests where id = $1`,
      [ref.id],
    );
  } else {
    const code = normalizeUserCode(ref.code);
    if (!code) return null;
    row = await one<PairingRow>(
      `select id, user_code, requested_name, platform, host(ip) as ip, status, created_at, expires_at,
              grant_kind, grant_scopes, grant_ttl_seconds
         from device_pairing_requests where user_code = $1 and expires_at > now()
        order by created_at desc limit 1`,
      [code],
    );
  }
  if (!row) return null;
  const status = effectiveStatus(row);
  const network = sameNetwork(row.ip, ctx.ip);
  // Typing the code already proves the user can see it; scanning a QR does not.
  // On a different network, picking (a 1-in-3 guess) isn't offered at all.
  const requireTypedCode = network !== true;
  const choices = 'id' in ref && status === 'pending' && !requireTypedCode ? shuffledChoices(row.user_code) : null;
  return {
    id: row.id,
    requestedName: row.requested_name,
    platform: row.platform,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status,
    sameNetwork: network,
    codeChoices: choices,
    requireTypedCode,
  };
}

function shuffledChoices(real: string): string[] {
  const set = new Set([real]);
  while (set.size < 3) set.add(userCode());
  const arr = [...set];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface ApprovalInput {
  requestId: string;
  /** The code the user confirmed matches the requesting screen (picked or typed). */
  confirmedCode: string;
  kind: 'owned' | 'shared';
  scopes: string[];
  ttlSeconds: number;
}

async function approvePairingInScope(session: SessionRecord, input: ApprovalInput, ctx: RequestContext) {
  assertCanApprove(session);
  if (input.kind !== 'owned' && input.kind !== 'shared') throw new UserFacingError('invalid', 'Choose a device type.');
  const allowed = GRANTABLE_SCOPES[input.kind];
  const scopes = [...new Set(input.scopes)];
  if (!scopes.every((s) => isScope(s) && allowed.includes(s))) {
    throw new UserFacingError('invalid_scope', 'One of the selected permissions can’t be granted to this type of device.');
  }
  if (!scopes.includes('profile:read')) scopes.unshift('profile:read');
  if (!GRANT_DURATIONS[input.kind].some((d) => d.seconds === input.ttlSeconds)) {
    throw new UserFacingError('invalid_duration', 'Choose one of the available access durations.');
  }
  const code = normalizeUserCode(input.confirmedCode);

  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new UserFacingError('not_pending', 'This request has expired or was already handled.', 409);

  return tx(async (c) => {
    // Transaction binding: require a passkey assertion made by this session for
    // this request within the last two minutes, and use it up.
    const confirmation = await one(
      `update webauthn_challenges set data = data || '{"used": true}'::jsonb
        where id = (
          select id from webauthn_challenges
           where purpose = 'stepup' and session_id = $1 and data->>'pairingRequestId' = $2
             and data->>'verified' = 'true' and not (data ? 'used')
             and consumed_at > now() - interval '2 minutes'
           order by consumed_at desc limit 1
           for update)
        returning id`,
      [session.id, input.requestId],
      c,
    );
    if (!confirmation) throw new UserFacingError('reauth_required', 'Confirm this approval with your passkey.', 403);

    const row = await one<PairingRow>(
      `select id, user_code, status, expires_at, host(ip) as ip from device_pairing_requests where id = $1 for update`,
      [input.requestId],
      c,
    );
    if (!row || effectiveStatus(row) !== 'pending') {
      throw new UserFacingError('not_pending', 'This request has expired or was already handled.', 409);
    }
    // Defence in depth against remote relays: a requester on another (or an
    // unknown) network can't be given device management or long-lived access.
    if (sameNetwork(row.ip, ctx.ip) !== true) {
      if (scopes.some((sc) => REMOTE_LIMITS.forbiddenScopes.includes(sc)) || (input.kind === 'owned' && input.ttlSeconds > REMOTE_LIMITS.maxOwnedTtl)) {
        throw new UserFacingError(
          'remote_limit',
          'This device isn’t on your network, so it can’t be allowed to manage devices or stay connected for more than 7 days.',
          403,
        );
      }
    }
    if (code !== row.user_code) {
      // A wrong pick suggests the user can't see the requesting screen: fail closed.
      await c.query(`update device_pairing_requests set status = 'rejected', decided_at = now() where id = $1`, [row.id]);
      await recordEvent(
        { type: 'pairing.rejected', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { reason: 'code_mismatch' } },
        ctx,
        c,
      );
      return { ok: false as const, reason: 'code_mismatch' as const };
    }
    await c.query(
      `update device_pairing_requests
          set status = 'approved', decided_at = now(), approver_user_id = $2, approver_session_id = $3,
              grant_kind = $4, grant_scopes = $5, grant_ttl_seconds = $6,
              expires_at = now() + make_interval(secs => $7)
        where id = $1`,
      [row.id, session.user_id, session.id, input.kind, scopes, input.ttlSeconds, CLAIM_WINDOW],
    );
    await recordEvent(
      {
        type: 'pairing.approved',
        userId: session.user_id,
        deviceId: session.device_id,
        sessionId: session.id,
        detail: { kind: input.kind, scopes, ttlSeconds: input.ttlSeconds },
      },
      ctx,
      c,
    );
    return { ok: true as const };
  });
}

async function rejectPairingInScope(session: SessionRecord, requestId: string, ctx: RequestContext) {
  assertCanApprove(session);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return false;
  const rows = await query(
    `update device_pairing_requests set status = 'rejected', decided_at = now()
      where id = $1 and status = 'pending' and expires_at > now() returning id`,
    [requestId],
  );
  if (rows.length) {
    await recordEvent(
      { type: 'pairing.rejected', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { reason: 'user' } },
      ctx,
    );
  }
  return rows.length === 1;
}

// ---------------------------------------------------------------- tenant-scoped entry points

// Rate limits are applied before the tenant transaction opens: their counters
// commit independently and must not hold a second pooled connection.
export const lookupPairingForApprover = async (...args: Parameters<typeof lookupPairingForApproverInScope>) => {
  if ('code' in args[1]) await rateLimit(`pair-lookup:${args[0].user_id}`, 10, 10 * 60);
  return asUser(args[0].user_id, () => lookupPairingForApproverInScope(...args));
};
export const approvePairing = async (...args: Parameters<typeof approvePairingInScope>) => {
  await rateLimit(`pair-approve:${args[0].user_id}`, 10, 10 * 60);
  return asUser(args[0].user_id, () => approvePairingInScope(...args));
};
export const rejectPairing = (...args: Parameters<typeof rejectPairingInScope>) =>
  asUser(args[0].user_id, () => rejectPairingInScope(...args));

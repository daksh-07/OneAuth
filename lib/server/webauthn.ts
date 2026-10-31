import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { one, query, tx, type Queryable } from './db';
import { RP_NAME, rpIdFor } from './env';
import { UserFacingError } from './errors';
import { recordEvent, type RequestContext } from './events';
import { findOrCreateDevice } from './devices';
import { createSession, isRecentlyReauthenticated, markReauthenticated, PRIMARY_SESSION_TTL, SHARED_SIGNIN_TTL, type SessionRecord } from './sessions';
import { rateLimit } from './ratelimit';
import { ALL_SCOPES, GRANTABLE_SCOPES } from '../scopes';
import { describeUserAgent } from '../ua';

const CHALLENGE_TTL = 5 * 60;
type Purpose = 'register' | 'login' | 'stepup' | 'add-passkey';

async function storeChallenge(
  c: { purpose: Purpose; challenge: string; origin: string; userId?: string; sessionId?: string; data?: Record<string, unknown> },
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into webauthn_challenges (purpose, challenge, user_id, session_id, data, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) returning id`,
    [c.purpose, c.challenge, c.userId ?? null, c.sessionId ?? null, { ...c.data, origin: c.origin }, CHALLENGE_TTL],
  );
  // Opportunistic cleanup keeps the table small without a cron job.
  await query(`delete from webauthn_challenges where expires_at < now() - interval '1 hour'`);
  return row!.id;
}

/** Atomically marks a challenge used. A challenge can be consumed exactly once. */
async function consumeChallenge(
  id: string,
  purpose: Purpose,
  origin: string,
  sessionId?: string,
): Promise<{ challenge: string; user_id: string | null; data: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserFacingError('challenge_invalid', 'This request has expired. Please try again.');
  const row = await one<{ challenge: string; user_id: string | null; data: Record<string, unknown> }>(
    `update webauthn_challenges set consumed_at = now()
      where id = $1 and purpose = $2 and consumed_at is null and expires_at > now()
        and session_id is not distinct from $3
     returning challenge, user_id, data`,
    [id, purpose, sessionId ?? null],
  );
  if (!row || row.data.origin !== origin) {
    throw new UserFacingError('challenge_invalid', 'This request has expired or was already used. Please try again.');
  }
  return row;
}

// ---------------------------------------------------------------- registration

export async function beginRegistration(input: { displayName: string; origin: string }, ctx: RequestContext) {
  await rateLimit(`register:${ctx.ip ?? 'unknown'}`, 10, 15 * 60);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 64) {
    throw new UserFacingError('invalid_name', 'Enter a name between 1 and 64 characters.');
  }
  const userId = randomBytes(32);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpIdFor(input.origin),
    userName: displayName,
    userDisplayName: displayName,
    userID: userId,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_TTL * 1000,
  });
  const challengeId = await storeChallenge({
    purpose: 'register',
    challenge: options.challenge,
    origin: input.origin,
    data: { displayName, webauthnUserId: userId.toString('base64url') },
  });
  return { challengeId, options };
}

export interface DeviceContext {
  deviceKey: string | null;
  kind: 'owned' | 'shared';
}

export async function finishRegistration(
  input: { challengeId: string; response: RegistrationResponseJSON; origin: string; device: DeviceContext },
  ctx: RequestContext,
) {
  const ch = await consumeChallenge(input.challengeId, 'register', input.origin);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: input.origin,
    expectedRPID: rpIdFor(input.origin),
    requireUserVerification: true,
  }).catch(() => ({ verified: false as const }));
  if (!verification.verified) {
    throw new UserFacingError('passkey_failed', 'Your passkey could not be verified. Please try again.');
  }
  const info = verification.registrationInfo;
  const displayName = String(ch.data.displayName);
  const webauthnUserId = Buffer.from(String(ch.data.webauthnUserId), 'base64url');

  return tx(async (c) => {
    const user = await one<{ id: string }>(
      `insert into users (webauthn_user_id, display_name) values ($1, $2) returning id`,
      [webauthnUserId, displayName],
      c,
    );
    const userId = user!.id;
    await query(`insert into user_profiles (user_id) values ($1)`, [userId], c);
    await query(`insert into subscriptions (user_id) values ($1)`, [userId], c);
    await insertAuthenticator(userId, info, c);
    const session = await startSessionForUser(userId, input.device, ctx, c);
    await recordEvent({ type: 'account.created', userId, deviceId: session.deviceId, sessionId: session.sessionId }, ctx, c);
    return session;
  });
}

async function insertAuthenticator(
  userId: string,
  info: Extract<Awaited<ReturnType<typeof verifyRegistrationResponse>>, { verified: true }>['registrationInfo'],
  c: Queryable,
  nickname = 'Passkey',
) {
  await query(
    `insert into authenticators (user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, nickname)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      info.credential.id,
      Buffer.from(info.credential.publicKey),
      info.credential.counter,
      info.credential.transports ?? [],
      info.credentialDeviceType,
      info.credentialBackedUp,
      info.aaguid,
      nickname,
    ],
    c,
  );
}

async function startSessionForUser(userId: string, device: DeviceContext, ctx: RequestContext, c: Queryable) {
  const { name, platform } = describeUserAgent(ctx.userAgent);
  const dev = await findOrCreateDevice(
    { userId, deviceKey: device.deviceKey, name, platform, kind: device.kind, via: 'passkey' },
    ctx,
    c,
  );
  // A passkey sign-in on a shared computer gets the same narrow scopes a shared pairing would.
  const scopes = device.kind === 'owned' ? ALL_SCOPES : GRANTABLE_SCOPES.shared;
  const ttl = device.kind === 'owned' ? PRIMARY_SESSION_TTL : SHARED_SIGNIN_TTL;
  const session = await createSession({ userId, deviceId: dev.id, kind: 'primary', scopes, ttlSeconds: ttl, reauth: true }, ctx, c);
  await recordEvent({ type: 'auth.signin', userId, deviceId: dev.id, sessionId: session.sessionId, detail: { kind: device.kind } }, ctx, c);
  return { ...session, userId, deviceId: dev.id, deviceKey: dev.deviceKey };
}

// ---------------------------------------------------------------- sign-in

export async function beginLogin(input: { origin: string }, ctx: RequestContext) {
  await rateLimit(`login:${ctx.ip ?? 'unknown'}`, 30, 15 * 60);
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(input.origin),
    userVerification: 'required',
    timeout: CHALLENGE_TTL * 1000,
  });
  const challengeId = await storeChallenge({ purpose: 'login', challenge: options.challenge, origin: input.origin });
  return { challengeId, options };
}

interface AuthenticatorRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
  webauthn_user_id: Buffer;
  status: string;
}

async function verifyAssertion(
  response: AuthenticationResponseJSON,
  challenge: string,
  origin: string,
  restrictToUserId?: string,
): Promise<AuthenticatorRow> {
  const auth = await one<AuthenticatorRow>(
    `select a.id, a.user_id, a.credential_id, a.public_key, a.counter, a.transports, u.webauthn_user_id, u.status
       from authenticators a join users u on u.id = a.user_id
      where a.credential_id = $1`,
    [typeof response.id === 'string' ? response.id : ''],
  );
  const fail = new UserFacingError('passkey_failed', 'That passkey isn’t recognised for this account.', 401);
  if (!auth || (restrictToUserId && auth.user_id !== restrictToUserId)) throw fail;
  const handle = response.response.userHandle;
  if (handle && Buffer.from(handle, 'base64url').compare(auth.webauthn_user_id) !== 0) throw fail;

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpIdFor(origin),
    requireUserVerification: true,
    credential: {
      id: auth.credential_id,
      publicKey: new Uint8Array(auth.public_key),
      counter: Number(auth.counter),
      transports: auth.transports as never,
    },
  }).catch(() => null);
  if (!result?.verified) throw fail;
  if (auth.status !== 'active') throw new UserFacingError('account_locked', 'This account is locked.', 403);

  await query(`update authenticators set counter = $2, last_used_at = now() where id = $1`, [
    auth.id,
    result.authenticationInfo.newCounter,
  ]);
  return auth;
}

export async function finishLogin(
  input: { challengeId: string; response: AuthenticationResponseJSON; origin: string; device: DeviceContext },
  ctx: RequestContext,
) {
  const ch = await consumeChallenge(input.challengeId, 'login', input.origin);
  let auth: AuthenticatorRow;
  try {
    auth = await verifyAssertion(input.response, ch.challenge, input.origin);
  } catch (err) {
    const known = await one<{ user_id: string }>(`select user_id from authenticators where credential_id = $1`, [
      String(input.response.id ?? ''),
    ]);
    if (known) await recordEvent({ type: 'auth.signin_failed', userId: known.user_id }, ctx);
    throw err;
  }
  return tx((c) => startSessionForUser(auth.user_id, input.device, ctx, c));
}

// ---------------------------------------------------------------- step-up

async function userCredentials(userId: string) {
  return query<{ credential_id: string; transports: string[] }>(
    `select credential_id, transports from authenticators where user_id = $1`,
    [userId],
  );
}

export async function beginStepUp(session: SessionRecord, origin: string) {
  await rateLimit(`stepup:${session.id}`, 20, 15 * 60);
  const creds = await userCredentials(session.user_id);
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(origin),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports })),
    timeout: CHALLENGE_TTL * 1000,
  });
  const challengeId = await storeChallenge({
    purpose: 'stepup',
    challenge: options.challenge,
    origin,
    userId: session.user_id,
    sessionId: session.id,
  });
  return { challengeId, options };
}

export async function finishStepUp(
  session: SessionRecord,
  input: { challengeId: string; response: AuthenticationResponseJSON; origin: string },
  ctx: RequestContext,
) {
  const ch = await consumeChallenge(input.challengeId, 'stepup', input.origin, session.id);
  await verifyAssertion(input.response, ch.challenge, input.origin, session.user_id);
  await markReauthenticated(session.id);
  await recordEvent({ type: 'auth.stepup', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
}

// ---------------------------------------------------------------- passkey management

function requireFreshReauth(session: SessionRecord) {
  if (!isRecentlyReauthenticated(session)) {
    throw new UserFacingError('reauth_required', 'Confirm it’s you with your passkey first.', 403);
  }
}

export async function beginAddPasskey(session: SessionRecord, origin: string) {
  requireFreshReauth(session);
  const user = await one<{ webauthn_user_id: Buffer; display_name: string }>(
    `select webauthn_user_id, display_name from users where id = $1`,
    [session.user_id],
  );
  const creds = await userCredentials(session.user_id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpIdFor(origin),
    userName: user!.display_name,
    userDisplayName: user!.display_name,
    userID: new Uint8Array(user!.webauthn_user_id),
    attestationType: 'none',
    excludeCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_TTL * 1000,
  });
  const challengeId = await storeChallenge({
    purpose: 'add-passkey',
    challenge: options.challenge,
    origin,
    userId: session.user_id,
    sessionId: session.id,
  });
  return { challengeId, options };
}

export async function finishAddPasskey(
  session: SessionRecord,
  input: { challengeId: string; response: RegistrationResponseJSON; origin: string; nickname: string },
  ctx: RequestContext,
) {
  requireFreshReauth(session);
  const ch = await consumeChallenge(input.challengeId, 'add-passkey', input.origin, session.id);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: input.origin,
    expectedRPID: rpIdFor(input.origin),
    requireUserVerification: true,
  }).catch(() => ({ verified: false as const }));
  if (!verification.verified) throw new UserFacingError('passkey_failed', 'Your passkey could not be verified.');
  const nickname = input.nickname.trim().slice(0, 48) || 'Passkey';
  await tx(async (c) => {
    await insertAuthenticator(session.user_id, verification.registrationInfo, c, nickname);
    await recordEvent({ type: 'passkey.added', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx, c);
  });
}

export async function removePasskey(session: SessionRecord, authenticatorId: string, ctx: RequestContext) {
  requireFreshReauth(session);
  await tx(async (c) => {
    // Lock the user's credentials so two concurrent removals can't delete the last two.
    const rows = await query<{ id: string }>(
      `select id from authenticators where user_id = $1 for update`,
      [session.user_id],
      c,
    );
    if (!rows.some((r) => r.id === authenticatorId)) throw new UserFacingError('not_found', 'Passkey not found.', 404);
    if (rows.length <= 1) {
      throw new UserFacingError('last_passkey', 'You can’t remove your only passkey. Add another one first.');
    }
    await query(`delete from authenticators where id = $1 and user_id = $2`, [authenticatorId, session.user_id], c);
    await recordEvent({ type: 'passkey.removed', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx, c);
  });
}

export { requireFreshReauth };

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { asUser, one, query } from './db';
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
): Promise<{ id: string; challenge: string; user_id: string | null; data: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserFacingError('challenge_invalid', 'This request has expired. Please try again.');
  const row = await one<{ id: string; challenge: string; user_id: string | null; data: Record<string, unknown> }>(
    `update webauthn_challenges set consumed_at = now()
      where id = $1 and purpose = $2 and consumed_at is null and expires_at > now()
        and session_id is not distinct from $3
     returning id, challenge, user_id, data`,
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

  // The new account's ID is chosen here so the whole creation runs inside its own tenant scope.
  const userId = randomUUID();
  return asUser(userId, async () => {
    await query(`insert into users (id, webauthn_user_id, display_name) values ($1, $2, $3)`, [userId, webauthnUserId, displayName]);
    await query(`insert into user_profiles (user_id) values ($1)`, [userId]);
    await query(`insert into subscriptions (user_id) values ($1)`, [userId]);
    await insertAuthenticator(userId, info);
    const session = await startSessionForUser(userId, input.device, ctx);
    await recordEvent({ type: 'account.created', userId, deviceId: session.deviceId, sessionId: session.sessionId }, ctx);
    return session;
  });
}

async function insertAuthenticator(
  userId: string,
  info: Extract<Awaited<ReturnType<typeof verifyRegistrationResponse>>, { verified: true }>['registrationInfo'],
  nickname = 'Passkey',
) {
  try {
    await insertAuthenticatorRow(userId, info, nickname);
  } catch (err) {
    // credential_id is unique: a passkey can belong to exactly one account.
    if ((err as { code?: string }).code === '23505') {
      throw new UserFacingError('passkey_exists', 'This passkey is already registered to an account.', 409);
    }
    throw err;
  }
}

async function insertAuthenticatorRow(
  userId: string,
  info: Extract<Awaited<ReturnType<typeof verifyRegistrationResponse>>, { verified: true }>['registrationInfo'],
  nickname: string,
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
  );
}

/** Must run inside the user's tenant scope. */
async function startSessionForUser(userId: string, device: DeviceContext, ctx: RequestContext) {
  const { name, platform } = describeUserAgent(ctx.userAgent);
  const dev = await findOrCreateDevice({ userId, deviceKey: device.deviceKey, name, platform, kind: device.kind, via: 'passkey' }, ctx);
  // A passkey sign-in on a shared computer gets the same narrow scopes a shared pairing would.
  const scopes = device.kind === 'owned' ? ALL_SCOPES : GRANTABLE_SCOPES.shared;
  const ttl = device.kind === 'owned' ? PRIMARY_SESSION_TTL : SHARED_SIGNIN_TTL;
  const session = await createSession({ userId, deviceId: dev.id, kind: 'primary', scopes, ttlSeconds: ttl, reauth: true }, ctx);
  await recordEvent({ type: 'auth.signin', userId, deviceId: dev.id, sessionId: session.sessionId, detail: { kind: device.kind } }, ctx);
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

/** Must run inside the credential owner's tenant scope; other users' credentials are invisible. */
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
  const fail = new UserFacingError('passkey_failed', 'That passkey isn’t recognised for this account.', 401);
  const credentialId = typeof input.response?.id === 'string' ? input.response.id : '';
  // Resolve which account the credential claims to belong to (SECURITY DEFINER),
  // then verify and sign in entirely inside that account's tenant scope.
  const owner = await one<{ uid: string | null }>(`select oneauth_resolve_credential($1) as uid`, [credentialId]);
  if (!owner?.uid) throw fail;
  const uid = owner.uid;
  try {
    return await asUser(uid, async () => {
      const auth = await verifyAssertion(input.response, ch.challenge, input.origin);
      return startSessionForUser(auth.user_id, input.device, ctx);
    });
  } catch (err) {
    if (err instanceof UserFacingError && err.code === 'passkey_failed') {
      await asUser(uid, () => recordEvent({ type: 'auth.signin_failed', userId: uid }, ctx));
    }
    throw err;
  }
}

// ---------------------------------------------------------------- step-up

async function userCredentials(userId: string) {
  return query<{ credential_id: string; transports: string[] }>(
    `select credential_id, transports from authenticators where user_id = $1`,
    [userId],
  );
}

/**
 * Step-up verification. With `forPairing`, the verified assertion becomes a
 * single-use confirmation of that specific pairing request (transaction
 * binding), rather than a general "recently verified" window.
 */
async function beginStepUpInScope(session: SessionRecord, origin: string, forPairing?: string) {
  if (forPairing !== undefined && !/^[0-9a-f-]{36}$/i.test(forPairing)) {
    throw new UserFacingError('invalid', 'Invalid request.');
  }
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
    data: forPairing ? { pairingRequestId: forPairing } : {},
  });
  return { challengeId, options };
}

async function finishStepUpInScope(
  session: SessionRecord,
  input: { challengeId: string; response: AuthenticationResponseJSON; origin: string },
  ctx: RequestContext,
) {
  const ch = await consumeChallenge(input.challengeId, 'stepup', input.origin, session.id);
  await verifyAssertion(input.response, ch.challenge, input.origin, session.user_id);
  await markReauthenticated(session.id);
  // Mark the challenge as successfully verified; a bound pairing approval consumes this marker.
  await query(`update webauthn_challenges set data = data || '{"verified": true}'::jsonb where id = $1`, [ch.id]);
  await recordEvent({ type: 'auth.stepup', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
}

// ---------------------------------------------------------------- passkey management

function requireFreshReauth(session: SessionRecord) {
  if (!isRecentlyReauthenticated(session)) {
    throw new UserFacingError('reauth_required', 'Confirm it’s you with your passkey first.', 403);
  }
}

async function beginAddPasskeyInScope(session: SessionRecord, origin: string) {
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

async function finishAddPasskeyInScope(
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
  // Runs inside the tenant transaction opened by finishAddPasskey.
  await insertAuthenticator(session.user_id, verification.registrationInfo, nickname);
  await recordEvent({ type: 'passkey.added', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
}

async function removePasskeyInScope(session: SessionRecord, authenticatorId: string, ctx: RequestContext) {
  requireFreshReauth(session);
  if (!/^[0-9a-f-]{36}$/i.test(authenticatorId)) throw new UserFacingError('not_found', 'Passkey not found.', 404);
  // Runs inside the tenant transaction opened by removePasskey. Lock the user's
  // credentials so two concurrent removals can't delete the last two.
  const rows = await query<{ id: string }>(`select id from authenticators where user_id = $1 for update`, [session.user_id]);
  if (!rows.some((r) => r.id === authenticatorId)) throw new UserFacingError('not_found', 'Passkey not found.', 404);
  if (rows.length <= 1) {
    throw new UserFacingError('last_passkey', 'You can’t remove your only passkey. Add another one first.');
  }
  await query(`delete from authenticators where id = $1 and user_id = $2`, [authenticatorId, session.user_id]);
  await recordEvent({ type: 'passkey.removed', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
}


// ---------------------------------------------------------------- tenant-scoped entry points

export const beginStepUp = async (session: SessionRecord, origin: string, forPairing?: string) => {
  await rateLimit(`stepup:${session.id}`, 20, 15 * 60);
  return asUser(session.user_id, () => beginStepUpInScope(session, origin, forPairing));
};
export const finishStepUp = (...args: Parameters<typeof finishStepUpInScope>) =>
  asUser(args[0].user_id, () => finishStepUpInScope(...args));
export const beginAddPasskey = (session: SessionRecord, origin: string) =>
  asUser(session.user_id, () => beginAddPasskeyInScope(session, origin));
export const finishAddPasskey = (...args: Parameters<typeof finishAddPasskeyInScope>) =>
  asUser(args[0].user_id, () => finishAddPasskeyInScope(...args));
export const removePasskey = (...args: Parameters<typeof removePasskeyInScope>) =>
  asUser(args[0].user_id, () => removePasskeyInScope(...args));

export { requireFreshReauth };

import { describe, expect, it } from 'vitest';
import { query, one } from '@/lib/server/db';
import { sha256 } from '@/lib/server/tokens';
import { beginLogin, beginRegistration, finishLogin, finishRegistration, beginAddPasskey, finishAddPasskey, removePasskey } from '@/lib/server/webauthn';
import { revokeSession, validateSessionToken } from '@/lib/server/sessions';
import { deleteAccount } from '@/lib/server/account';
import { SoftAuthenticator } from '../helpers/soft-authenticator';
import { createUser, ctx, ORIGIN, signIn, stepUpSession } from '../helpers/fixtures';

describe('registration', () => {
  it('creates a user, passkey, device and full-scope session', async () => {
    const user = await createUser();
    const session = await user.session();
    expect(session.display_name).toBe('Alex Chen');
    expect(session.kind).toBe('primary');
    expect(session.device_kind).toBe('owned');
    expect(session.scopes).toContain('security:manage');
    const auths = await query(`select * from authenticators where user_id = $1`, [user.userId]);
    expect(auths).toHaveLength(1);
  });

  it('stores only a hash of the session token', async () => {
    const user = await createUser();
    const rows = await query<{ token_hash: Buffer }>(`select token_hash from sessions where user_id = $1`, [user.userId]);
    expect(rows[0].token_hash.equals(sha256(user.token))).toBe(true);
    const raw = await query(`select 1 from sessions where token_hash::text like $1`, [`%${user.token}%`]);
    expect(raw).toHaveLength(0);
  });

  it('rejects a replayed registration challenge', async () => {
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx());
    const response = auth.register(options, ORIGIN);
    await finishRegistration({ challengeId, response, origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx());
    await expect(
      finishRegistration({ challengeId, response, origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx()),
    ).rejects.toMatchObject({ code: 'challenge_invalid' });
  });

  it('rejects a response produced for a different origin', async () => {
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx());
    const response = auth.register(options, 'https://evil.example');
    await expect(
      finishRegistration({ challengeId, response, origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
    expect(await query(`select 1 from users`)).toHaveLength(0);
  });

  it('requires user verification (biometric / PIN) on the authenticator', async () => {
    const auth = new SoftAuthenticator();
    auth.uv = false;
    const { challengeId, options } = await beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx());
    await expect(
      finishRegistration({ challengeId, response: auth.register(options, ORIGIN), origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('validates display names', async () => {
    await expect(beginRegistration({ displayName: '   ', origin: ORIGIN }, ctx())).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(beginRegistration({ displayName: 'x'.repeat(65), origin: ORIGIN }, ctx())).rejects.toMatchObject({ code: 'invalid_name' });
  });

  it('rate-limits registration attempts per IP', async () => {
    for (let i = 0; i < 10; i++) await beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx('198.51.100.7'));
    await expect(beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx('198.51.100.7'))).rejects.toHaveProperty('retryAfterSeconds');
  });
});

describe('sign-in', () => {
  it('signs in with an existing passkey and reuses the device when the key matches', async () => {
    const user = await createUser();
    const res = await signIn(user, { deviceKey: user.deviceKey });
    const session = (await validateSessionToken(res.token))!;
    expect(session.user_id).toBe(user.userId);
    expect(session.device_id).toBe((await user.session()).device_id);
  });

  it('rejects a signature from an unknown credential', async () => {
    await createUser();
    const stranger = new SoftAuthenticator();
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    await expect(
      finishLogin({ challengeId, response: stranger.authenticate(options, ORIGIN), origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('rejects a cloned authenticator whose counter goes backwards, and logs the failure', async () => {
    const user = await createUser();
    await signIn(user); // counter -> 1
    await signIn(user); // counter -> 2
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    const response = user.authenticator.authenticate(options, ORIGIN, { counter: 1 });
    await expect(
      finishLogin({ challengeId, response, origin: ORIGIN, device: { deviceKey: null, kind: 'owned' } }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
    const failed = await query(`select 1 from security_events where user_id = $1 and type = 'auth.signin_failed'`, [user.userId]);
    expect(failed).toHaveLength(1);
  });

  it('gives a shared-computer sign-in narrow scopes and a short lifetime', async () => {
    const user = await createUser();
    const res = await signIn(user, { shared: true });
    const s = (await validateSessionToken(res.token))!;
    expect(s.device_kind).toBe('shared');
    expect(s.scopes).toEqual(['profile:read', 'devices:read']);
    expect(s.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(8 * 3600 * 1000 + 5000);
  });

  it('never reuses a device key that belongs to another account (device fixation)', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const res = await signIn(bob, { deviceKey: alice.deviceKey });
    expect(res.deviceKey).not.toBe(alice.deviceKey);
    const s = (await validateSessionToken(res.token))!;
    expect(s.device_id).not.toBe((await alice.session()).device_id);
  });
});

describe('sessions', () => {
  it('rejects unknown, revoked and expired tokens', async () => {
    const user = await createUser();
    expect(await validateSessionToken('nope')).toBeNull();
    expect(await validateSessionToken(undefined)).toBeNull();

    const s = await user.session();
    await query(`update sessions set expires_at = now() - interval '1 second', created_at = now() - interval '1 day' where id = $1`, [s.id]);
    expect(await validateSessionToken(user.token)).toBeNull();

    const other = await signIn(user);
    const s2 = (await validateSessionToken(other.token))!;
    expect(await revokeSession(user.userId, s2.id, 'test')).toBe(true);
    expect(await validateSessionToken(other.token)).toBeNull();
  });

  it('expires idle sessions', async () => {
    const user = await createUser();
    await query(`update sessions set last_seen_at = now() - interval '8 days' where user_id = $1`, [user.userId]);
    expect(await validateSessionToken(user.token)).toBeNull();
  });

  it('rejects sessions of locked accounts', async () => {
    const user = await createUser();
    await query(`update users set status = 'locked' where id = $1`, [user.userId]);
    expect(await validateSessionToken(user.token)).toBeNull();
  });

  it('does not let one user revoke another user’s session', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceSession = await alice.session();
    expect(await revokeSession(bob.userId, aliceSession.id, 'attack')).toBe(false);
    expect(await validateSessionToken(alice.token)).not.toBeNull();
  });
});

describe('step-up and passkey management', () => {
  it('requires a fresh passkey check to add a passkey', async () => {
    const user = await createUser();
    await query(`update sessions set reauth_at = now() - interval '10 minutes' where user_id = $1`, [user.userId]);
    await expect(beginAddPasskey(await user.session(), ORIGIN)).rejects.toMatchObject({ code: 'reauth_required' });

    const fresh = await stepUpSession(user, await user.session());
    const second = new SoftAuthenticator();
    const { challengeId, options } = await beginAddPasskey(fresh, ORIGIN);
    expect(options.excludeCredentials).toHaveLength(1);
    await finishAddPasskey(fresh, { challengeId, response: second.register(options, ORIGIN), origin: ORIGIN, nickname: 'YubiKey' }, ctx());
    expect(await query(`select 1 from authenticators where user_id = $1`, [user.userId])).toHaveLength(2);
  });

  it('a step-up challenge is bound to the session that requested it', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const { beginStepUp, finishStepUp } = await import('@/lib/server/webauthn');
    const { challengeId, options } = await beginStepUp(await alice.session(), ORIGIN);
    await expect(
      finishStepUp(await bob.session(), { challengeId, response: bob.authenticator.authenticate(options, ORIGIN), origin: ORIGIN }, ctx()),
    ).rejects.toMatchObject({ code: 'challenge_invalid' });
  });

  it('a step-up cannot be satisfied with another user’s passkey', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const { beginStepUp, finishStepUp } = await import('@/lib/server/webauthn');
    const session = await alice.session();
    const { challengeId, options } = await beginStepUp(session, ORIGIN);
    await expect(
      finishStepUp(session, { challengeId, response: bob.authenticator.authenticate({ ...options, allowCredentials: [] }, ORIGIN), origin: ORIGIN }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('refuses to remove the last passkey', async () => {
    const user = await createUser();
    const s = await user.session();
    const auth = await one<{ id: string }>(`select id from authenticators where user_id = $1`, [user.userId]);
    await expect(removePasskey(s, auth!.id, ctx())).rejects.toMatchObject({ code: 'last_passkey' });
  });

  it('cannot remove another user’s passkey', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const bobsKey = await one<{ id: string }>(`select id from authenticators where user_id = $1`, [bob.userId]);
    await expect(removePasskey(await alice.session(), bobsKey!.id, ctx())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('account deletion', () => {
  it('requires confirmation and removes all user data', async () => {
    const user = await createUser();
    const s = await user.session();
    await expect(deleteAccount(s, 'yes')).rejects.toMatchObject({ code: 'confirmation' });
    await deleteAccount(s, 'Delete my account');
    for (const table of ['users', 'authenticators', 'devices', 'sessions', 'security_events']) {
      expect(await query(`select 1 from ${table}`)).toHaveLength(0);
    }
    expect(await validateSessionToken(user.token)).toBeNull();
  });
});

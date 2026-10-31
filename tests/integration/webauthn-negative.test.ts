import { describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { beginLogin, beginRegistration, finishLogin, finishRegistration } from '@/lib/server/webauthn';
import { SoftAuthenticator } from '../helpers/soft-authenticator';
import { createUser, ctx, ORIGIN } from '../helpers/fixtures';

const device = { deviceKey: null, kind: 'owned' as const };

describe('WebAuthn negative cases', () => {
  it('rejects a registration signed for a different relying-party ID', async () => {
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await beginRegistration({ displayName: 'A', origin: ORIGIN }, ctx());
    const response = auth.register({ ...options, rp: { ...options.rp, id: 'evil.example' } }, ORIGIN);
    await expect(finishRegistration({ challengeId, response, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({ code: 'passkey_failed' });
    expect(await query(`select 1 from users`)).toHaveLength(0);
  });

  it('rejects an assertion signed for a different relying-party ID', async () => {
    const user = await createUser();
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    const response = user.authenticator.authenticate({ ...options, rpId: 'evil.example' }, ORIGIN);
    await expect(finishLogin({ challengeId, response, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('rejects expired challenges', async () => {
    const user = await createUser();
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    await query(`update webauthn_challenges set expires_at = now() - interval '1 second', created_at = now() - interval '10 minutes' where id = $1`, [challengeId]);
    await expect(
      finishLogin({ challengeId, response: user.authenticator.authenticate(options, ORIGIN), origin: ORIGIN, device }, ctx()),
    ).rejects.toMatchObject({ code: 'challenge_invalid' });
  });

  it('rejects a replayed assertion (same challenge, same signature)', async () => {
    const user = await createUser();
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    const response = user.authenticator.authenticate(options, ORIGIN);
    await finishLogin({ challengeId, response, origin: ORIGIN, device }, ctx());
    await expect(finishLogin({ challengeId, response, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({ code: 'challenge_invalid' });
  });

  it('rejects an assertion whose signature was tampered with', async () => {
    const user = await createUser();
    const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
    const response = user.authenticator.authenticate(options, ORIGIN);
    const sig = Buffer.from(response.response.signature, 'base64url');
    sig[sig.length - 1] ^= 0xff;
    response.response.signature = sig.toString('base64url');
    await expect(finishLogin({ challengeId, response, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('rejects malformed responses without crashing', async () => {
    await createUser();
    for (const response of [
      {},
      { id: 'x', response: {} },
      { id: 'x', rawId: 'x', type: 'public-key', response: { clientDataJSON: '!!', authenticatorData: '', signature: '' } },
    ]) {
      const { challengeId } = await beginLogin({ origin: ORIGIN }, ctx());
      await expect(finishLogin({ challengeId, response: response as never, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({
        code: 'passkey_failed',
      });
    }
    const reg = await beginRegistration({ displayName: 'B', origin: ORIGIN }, ctx());
    await expect(
      finishRegistration({ challengeId: reg.challengeId, response: { id: 'x' } as never, origin: ORIGIN, device }, ctx()),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
  });

  it('cannot register an existing credential ID to a second account', async () => {
    const alice = await createUser('Alice');
    const { challengeId, options } = await beginRegistration({ displayName: 'Mallory', origin: ORIGIN }, ctx());
    // Re-register Alice's authenticator (same credential ID) under a new account.
    const response = alice.authenticator.register(options, ORIGIN);
    await expect(finishRegistration({ challengeId, response, origin: ORIGIN, device }, ctx())).rejects.toMatchObject({ code: 'passkey_exists', status: 409 });
    const owners = await query(`select user_id from authenticators where credential_id = $1`, [response.id]);
    expect(owners).toEqual([{ user_id: alice.userId }]);
    expect(await query(`select 1 from users where display_name = 'Mallory'`)).toHaveLength(0);
  });

  it('rejects a challenge ID that is not a UUID', async () => {
    await expect(
      finishLogin({ challengeId: "x' or '1'='1", response: {} as never, origin: ORIGIN, device }, ctx()),
    ).rejects.toMatchObject({ code: 'challenge_invalid' });
  });
});

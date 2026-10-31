import { describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { approvePairing, claimPairing, createPairingRequest, getPairingStatusForRequester, lookupPairingForApprover, rejectPairing } from '@/lib/server/pairing';
import { validateSessionToken } from '@/lib/server/sessions';
import { revokeDevice, listDevices } from '@/lib/server/devices';
import { createUser, ctx, signIn, stepUpSession, type TestUser } from '../helpers/fixtures';

/** A passkey assertion bound to approving this specific request (what the UI does). */
async function confirmFor(user: TestUser, requestId: string) {
  return stepUpSession(user, await user.session(), requestId);
}

async function approvedRequest(opts: { kind?: 'owned' | 'shared'; scopes?: string[]; ttl?: number } = {}) {
  const owner = await createUser('Owner');
  const req = await createPairingRequest(ctx('203.0.113.50'));
  const session = await confirmFor(owner, req.id);
  const result = await approvePairing(
    session,
    { requestId: req.id, confirmedCode: req.code, kind: opts.kind ?? 'shared', scopes: opts.scopes ?? ['profile:read'], ttlSeconds: opts.ttl ?? 3600 },
    ctx(),
  );
  return { owner, req, session, result };
}

describe('pairing request', () => {
  it('starts pending with a readable one-time code', async () => {
    const req = await createPairingRequest(ctx());
    expect(req.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect((await getPairingStatusForRequester(req.secret))?.status).toBe('pending');
    expect(await getPairingStatusForRequester('wrong-secret')).toBeNull();
  });

  it('offers three code choices, exactly one of which is correct', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    const view = await lookupPairingForApprover(await owner.session(), { id: req.id }, ctx());
    expect(view!.codeChoices).toHaveLength(3);
    expect(view!.codeChoices!.filter((c) => c === req.code)).toHaveLength(1);
  });

  it('reports whether the requester is on the same network', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx('203.0.113.10'));
    expect((await lookupPairingForApprover(await owner.session(), { id: req.id }, ctx('203.0.113.10')))!.sameNetwork).toBe(true);
    expect((await lookupPairingForApprover(await owner.session(), { id: req.id }, ctx('198.51.100.1')))!.sameNetwork).toBe(false);
  });

  it('finds a request by typed code, case- and separator-insensitively', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    const typed = req.code.replace('-', ' ').toLowerCase();
    expect((await lookupPairingForApprover(await owner.session(), { code: typed }, ctx()))!.id).toBe(req.id);
  });
});

describe('approval', () => {
  it('requires a passkey confirmation bound to this exact request', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    const other = await createPairingRequest(ctx());
    const input = { requestId: req.id, confirmedCode: req.code, kind: 'shared' as const, scopes: ['profile:read'], ttlSeconds: 3600 };
    // A fresh general sign-in is not enough.
    await expect(approvePairing(await owner.session(), input, ctx())).rejects.toMatchObject({ code: 'reauth_required' });
    // A confirmation for a different request is not enough.
    await expect(approvePairing(await confirmFor(owner, other.id), input, ctx())).rejects.toMatchObject({ code: 'reauth_required' });
    expect((await approvePairing(await confirmFor(owner, req.id), input, ctx())).ok).toBe(true);
  });

  it('uses each confirmation once and rejects stale ones', async () => {
    const owner = await createUser();
    const a = await createPairingRequest(ctx());
    const s = await confirmFor(owner, a.id);
    await query(`update webauthn_challenges set consumed_at = now() - interval '3 minutes' where purpose = 'stepup'`);
    await expect(
      approvePairing(s, { requestId: a.id, confirmedCode: a.code, kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx()),
    ).rejects.toMatchObject({ code: 'reauth_required' });

    const b = await createPairingRequest(ctx());
    const s2 = await confirmFor(owner, b.id);
    await approvePairing(s2, { requestId: b.id, confirmedCode: 'AAAA-AAAA', kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx());
    const used = await query(`select 1 from webauthn_challenges where data->>'pairingRequestId' = $1 and data ? 'used'`, [b.id]);
    expect(used).toHaveLength(1);
  });

  it('a confirmation from another user’s session does not count', async () => {
    const owner = await createUser('Owner');
    const intruder = await createUser('Intruder');
    const req = await createPairingRequest(ctx());
    await confirmFor(owner, req.id);
    await expect(
      approvePairing(await intruder.session(), { requestId: req.id, confirmedCode: req.code, kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx()),
    ).rejects.toMatchObject({ code: 'reauth_required' });
  });

  it('cancels the request when the wrong code is picked', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    const s = await confirmFor(owner, req.id);
    const res = await approvePairing(s, { requestId: req.id, confirmedCode: 'AAAA-AAAA', kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx());
    expect(res).toEqual({ ok: false, reason: 'code_mismatch' });
    expect((await getPairingStatusForRequester(req.secret))?.status).toBe('rejected');
    // Even with a fresh confirmation, a cancelled request stays cancelled.
    await expect(
      approvePairing(await confirmFor(owner, req.id), { requestId: req.id, confirmedCode: req.code, kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx()),
    ).rejects.toMatchObject({ code: 'not_pending' });
    expect(s.id).toBeTruthy();
  });

  it('never grants a shared device management or account scopes', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    for (const scope of ['devices:manage', 'security:manage', 'security:read', 'admin:everything']) {
      await expect(
        approvePairing(await confirmFor(owner, req.id), { requestId: req.id, confirmedCode: req.code, kind: 'shared', scopes: [scope], ttlSeconds: 3600 }, ctx()),
      ).rejects.toMatchObject({ code: 'invalid_scope' });
    }
  });

  it('never grants security:manage, even to an owned device', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    await expect(
      approvePairing(await confirmFor(owner, req.id), { requestId: req.id, confirmedCode: req.code, kind: 'owned', scopes: ['security:manage'], ttlSeconds: 7 * 86400 }, ctx()),
    ).rejects.toMatchObject({ code: 'invalid_scope' });
  });

  it('only accepts the configured durations', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    await expect(
      approvePairing(await confirmFor(owner, req.id), { requestId: req.id, confirmedCode: req.code, kind: 'shared', scopes: [], ttlSeconds: 30 * 86400 }, ctx()),
    ).rejects.toMatchObject({ code: 'invalid_duration' });
  });

  it('cannot approve an expired request', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    const confirmed = await confirmFor(owner, req.id);
    await query(`update device_pairing_requests set expires_at = now() - interval '1 second', created_at = now() - interval '6 minutes'`);
    await expect(
      approvePairing(confirmed, { requestId: req.id, confirmedCode: req.code, kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx()),
    ).rejects.toMatchObject({ code: 'not_pending' });
  });

  it('cannot be performed from a paired or shared session (no approval chains)', async () => {
    const { req: first, owner } = await approvedRequest({ kind: 'owned', scopes: ['profile:read', 'devices:read', 'devices:manage'], ttl: 7 * 86400 });
    const claimed = await claimPairing(first.secret, null, ctx());
    const paired = (await validateSessionToken(claimed.token))!;
    expect(paired.scopes).toContain('devices:manage');
    const second = await createPairingRequest(ctx());
    await expect(lookupPairingForApprover(paired, { id: second.id }, ctx())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      approvePairing(paired, { requestId: second.id, confirmedCode: second.code, kind: 'shared', scopes: [], ttlSeconds: 3600 }, ctx()),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const shared = await signIn(owner, { shared: true });
    const sharedSession = (await validateSessionToken(shared.token))!;
    await expect(rejectPairing(sharedSession, second.id, ctx())).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('claim', () => {
  it('issues a session with exactly the approved scopes and expiry, once', async () => {
    const { req, owner } = await approvedRequest({ kind: 'shared', scopes: ['profile:read', 'devices:read'], ttl: 900 });
    expect((await getPairingStatusForRequester(req.secret))?.status).toBe('approved');
    const claimed = await claimPairing(req.secret, null, ctx());
    const s = (await validateSessionToken(claimed.token))!;
    expect(s.user_id).toBe(owner.userId);
    expect(s.kind).toBe('paired');
    expect(s.device_kind).toBe('shared');
    expect(s.scopes.sort()).toEqual(['devices:read', 'profile:read']);
    expect(Math.abs(s.expires_at.getTime() - Date.now() - 900_000)).toBeLessThan(10_000);

    await expect(claimPairing(req.secret, null, ctx())).rejects.toMatchObject({ code: 'not_claimable' });
    const grants = await query(`select 1 from device_grants where user_id = $1`, [owner.userId]);
    expect(grants).toHaveLength(1);
  });

  it('cannot be claimed before approval, after rejection, or with the wrong secret', async () => {
    const owner = await createUser();
    const req = await createPairingRequest(ctx());
    await expect(claimPairing(req.secret, null, ctx())).rejects.toMatchObject({ code: 'not_claimable' });
    await rejectPairing(await owner.session(), req.id, ctx());
    await expect(claimPairing(req.secret, null, ctx())).rejects.toMatchObject({ code: 'not_claimable' });
    const { req: approved } = await approvedRequest();
    await expect(claimPairing('not-the-secret', null, ctx())).rejects.toMatchObject({ code: 'not_claimable' });
    expect((await getPairingStatusForRequester(approved.secret))?.status).toBe('approved');
  });

  it('handles concurrent claims of the same request with exactly one winner', async () => {
    const { req } = await approvedRequest();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => claimPairing(req.secret, null, ctx())));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('cannot be claimed after the claim window closes', async () => {
    const { req } = await approvedRequest();
    await query(`update device_pairing_requests set expires_at = now() - interval '1 second', created_at = now() - interval '10 minutes'`);
    await expect(claimPairing(req.secret, null, ctx())).rejects.toMatchObject({ code: 'not_claimable' });
  });
});

describe('revocation', () => {
  it('revoking a device ends its sessions immediately', async () => {
    const { req, owner, session } = await approvedRequest();
    const claimed = await claimPairing(req.secret, null, ctx());
    const paired = (await validateSessionToken(claimed.token))!;
    expect(await revokeDevice(owner.userId, paired.device_id, session.id, ctx())).toBe(true);
    expect(await validateSessionToken(claimed.token)).toBeNull();
    expect((await listDevices(owner.userId)).map((d) => d.id)).not.toContain(paired.device_id);
    const grants = await query<{ revoked_at: Date | null }>(`select revoked_at from device_grants where device_id = $1`, [paired.device_id]);
    expect(grants[0].revoked_at).not.toBeNull();
  });

  it('one user cannot revoke or list another user’s device (BOLA)', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceDevice = (await alice.session()).device_id;
    expect(await revokeDevice(bob.userId, aliceDevice, (await bob.session()).id, ctx())).toBe(false);
    expect(await validateSessionToken(alice.token)).not.toBeNull();
    expect((await listDevices(bob.userId)).map((d) => d.id)).not.toContain(aliceDevice);
  });
});

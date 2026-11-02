import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, ctx } from '../helpers/fixtures';
import { secondBrowser, setUpVault, type Browser } from '../helpers/cloud';
import * as vault from '@/lib/server/cloud/vault';
import * as rot from '@/lib/server/cloud/rotation';
import * as v from '@/lib/vault/crypto';
import { prepareRotation, rewrapBatch, startPayload } from '@/lib/vault/rotate';
import { checkUnlock, markConfirmed, memoryPinStore, trustOwnKey, verifyResume, type PinStore } from '@/lib/vault/trust';

/**
 * Phase 2C: the browser's defences against a server that has write access to
 * the database (the attacker writes rows directly here). These checks are made
 * by the client; the server is not trusted in these tests.
 */
beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

async function unlockAs(b: Browser, store: PinStore) {
  const s = await vault.getVaultState(await b.session());
  return checkUnlock({
    envelope: s.device!.envelope!,
    privateKey: b.keys.privateKey,
    vaultId: s.vault!.id,
    serverVersion: s.vault!.key_version,
    transitions: s.transitions,
    store,
  });
}

/** Creator A (trusts its own key) and an approved browser B (confirmed its code), both pinned at version 1. */
async function twoBrowsers() {
  const user = await createUser();
  const base = await setUpVault(user);
  const storeA = memoryPinStore();
  await trustOwnKey(storeA, base.vk, base.vaultId, 1);
  const b = await secondBrowser(user);
  const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
  await vault.approveVaultDevice(
    await base.a.session(),
    reg.id,
    { envelope: await v.wrapVaultKeyForDevice(base.vk, b.jwk, 1), fingerprint: reg.fingerprint, keyVersion: 1 },
    ctx(),
  );
  const storeB = memoryPinStore();
  const first = await unlockAs(b, storeB);
  expect(first.trust).toBe('needs_confirmation'); // new to B: compare codes before writing
  // Both screens show the same confirmation code when nothing was tampered with.
  expect(await v.vaultConfirmationCode(first.vaultKey, base.vaultId, 1, b.jwk)).toBe(await v.vaultConfirmationCode(base.vk, base.vaultId, 1, b.jwk));
  await markConfirmed(storeB, 1);
  return { user, ...base, storeA, b, storeB, bVaultDeviceId: reg.id };
}

async function rotate(s: Awaited<ReturnType<typeof twoBrowsers>>, opts: { keepRecoveryKey?: Uint8Array } = {}) {
  const prepared = await prepareRotation();
  const active = (await vault.getVaultState(await s.a.session())).devices.filter((d) => d.status === 'active');
  const body = await startPayload(prepared, s.vaultId, active, { oldKey: s.vk, fromVersion: 1, ...opts });
  const { rotationId } = await rot.startRotation(await s.a.session(), { reason: 'manual', keyVersion: 1, ...body }, ctx());
  for (;;) {
    const work = await rot.rotationWork(await s.a.session());
    if (!work.files.length && !work.folders.length && !work.items.length) break;
    await rot.submitRotationBatch(await s.a.session(), { rotationId, ...(await rewrapBatch(work, s.vk, prepared.vaultKey, s.vaultId)) });
  }
  await rot.commitRotation(await s.a.session(), { rotationId }, ctx());
  return prepared;
}

describe('trust in a new vault key', () => {
  it('lets an offline browser accept a genuine rotation automatically (transition proof)', async () => {
    const s = await twoBrowsers();
    const prepared = await rotate(s);
    const res = await unlockAs(s.b, s.storeB);
    expect(res).toMatchObject({ keyVersion: 2, trust: 'trusted' });
    expect(res.vaultKey).toEqual(prepared.vaultKey);
  });

  it('refuses a rollback to an older envelope, even if the server also rolls back the version', async () => {
    const s = await twoBrowsers();
    const [old] = await query<{ envelope: string }>(`select envelope from vault_devices where id = $1`, [s.bVaultDeviceId]);
    await rotate(s);
    await unlockAs(s.b, s.storeB); // B now knows version 2
    // Attacker restores the old (VK1) envelope and version, which a removed browser could still open.
    await query(`update vault_devices set envelope = $2 where id = $1`, [s.bVaultDeviceId, old.envelope]);
    await query(`update vaults set key_version = 1 where user_id = $1`, [s.user.userId]);
    await expect(unlockAs(s.b, s.storeB)).rejects.toMatchObject({ code: 'rollback' });
  });

  it('refuses a different key presented under a version the browser already knows', async () => {
    const s = await twoBrowsers();
    const injected = v.generateVaultKey();
    await query(`update vault_devices set envelope = $2 where id = $1`, [s.bVaultDeviceId, await v.wrapVaultKeyForDevice(injected, s.b.jwk, 1)]);
    await expect(unlockAs(s.b, s.storeB)).rejects.toMatchObject({ code: 'substituted' });
  });

  it('never auto-trusts a "new version" the server invents; its confirmation code won’t match', async () => {
    const s = await twoBrowsers();
    const injected = v.generateVaultKey();
    // Fake rotation: version 2 with a key the attacker chose, and a proof it can't make properly.
    await query(`update vaults set key_version = 2 where user_id = $1`, [s.user.userId]);
    await query(`update vault_devices set envelope = $2 where id = $1`, [s.bVaultDeviceId, await v.wrapVaultKeyForDevice(injected, s.b.jwk, 2)]);
    const [vt] = await query<{ id: string }>(`select id from vaults where user_id = $1`, [s.user.userId]);
    await query(
      `insert into vault_rotations (user_id, vault_id, from_version, to_version, status, reason, next_recovery_envelope, next_recovery_verifier, transition_proof)
       values ($1, $2, 1, 2, 'committed', 'manual', $3, decode(repeat('00', 32), 'hex'), $4)`,
      [s.user.userId, vt.id, 'A'.repeat(54) + '==', await v.transitionProof(v.generateVaultKey(), injected, s.vaultId, 1)],
    );
    const res = await unlockAs(s.b, s.storeB);
    expect(res.trust).toBe('needs_confirmation');
    // The genuine browser A would display a code from the real key; B's differs, so the user doesn't confirm.
    expect(await v.vaultConfirmationCode(res.vaultKey, s.vaultId, 2, s.b.jwk)).not.toBe(await v.vaultConfirmationCode(s.vk, s.vaultId, 2, s.b.jwk));
  });

  it('refuses to finish a planted rotation (would otherwise re-wrap every file key to the attacker)', async () => {
    const s = await twoBrowsers();
    const injected = v.generateVaultKey();
    const [vt] = await query<{ id: string }>(`select id from vaults where user_id = $1`, [s.user.userId]);
    const aId = (await vault.getVaultState(await s.a.session())).device!.id;
    await query(`update vault_devices set next_envelope = $2 where id = $1`, [aId, await v.wrapVaultKeyForDevice(injected, s.a.jwk, 2)]);
    await query(
      `insert into vault_rotations (user_id, vault_id, from_version, to_version, status, reason, next_recovery_envelope, next_recovery_verifier, transition_proof)
       values ($1, $2, 1, 2, 'in_progress', 'manual', $3, decode(repeat('00', 32), 'hex'), $4)`,
      [s.user.userId, vt.id, 'A'.repeat(54) + '==', 'A'.repeat(43) + '='],
    );
    const status = await rot.rotationStatus(await s.a.session());
    const next = await v.unwrapVaultKeyForDevice(status.rotation!.nextEnvelope!, s.a.keys.privateKey);
    expect(await verifyResume(s.vk, next, s.vaultId, 1, status.rotation!.transition_proof)).toBe(false);
    // A genuine rotation's proof does verify for a resuming browser.
    expect(await verifyResume(s.vk, injected, s.vaultId, 1, await v.transitionProof(s.vk, injected, s.vaultId, 1))).toBe(true);
  });

  it('requires a transition proof to start a rotation', async () => {
    const s = await twoBrowsers();
    const prepared = await prepareRotation();
    const active = (await vault.getVaultState(await s.a.session())).devices.filter((d) => d.status === 'active');
    const { transitionProof: _omit, ...body } = await startPayload(prepared, s.vaultId, active, { oldKey: s.vk, fromVersion: 1 });
    void _omit;
    await expect(rot.startRotation(await s.a.session(), { reason: 'manual', keyVersion: 1, ...body, transitionProof: undefined }, ctx())).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('keeping the recovery key through a rotation', () => {
  it('keeps the current recovery key valid when the user re-enters it', async () => {
    const s = await twoBrowsers();
    const prepared = await rotate(s, { keepRecoveryKey: s.rk.bytes });
    const env = await vault.getRecoveryEnvelope(await s.a.session());
    expect(await v.unwrapVaultKeyForRecovery(env!.recovery_envelope, s.rk.bytes, s.vaultId)).toEqual(prepared.vaultKey);
    await expect(v.unwrapVaultKeyForRecovery(env!.recovery_envelope, prepared.recovery.bytes, s.vaultId)).rejects.toThrow();
  });

  it('refuses without proof of the current recovery key', async () => {
    const s = await twoBrowsers();
    const wrong = await v.generateRecoveryKey();
    await expect(rotate(s, { keepRecoveryKey: wrong.bytes })).rejects.toMatchObject({ code: 'recovery_mismatch' });
  });

  it('requires a new recovery key once a browser unlocked with it has been removed', async () => {
    const s = await twoBrowsers();
    const c = await secondBrowser(s.user);
    await vault.registerVaultDevice(await c.session(), { publicJwk: c.jwk }, ctx());
    await vault.recoverVaultDevice(await c.session(), { envelope: await v.wrapVaultKeyForDevice(s.vk, c.jwk, 1), recoveryProof: await v.recoveryProof(s.rk.bytes, s.vaultId) }, ctx());
    const cId = (await vault.getVaultState(await c.session())).device!.id;
    await vault.revokeVaultDevice(await s.a.session(), cId, ctx());
    await expect(rotate(s, { keepRecoveryKey: s.rk.bytes })).rejects.toMatchObject({ code: 'recovery_replacement_required' });
    // Replacing it works, and afterwards keeping the new one is allowed again.
    await rotate(s);
    void randomUUID;
  });
});

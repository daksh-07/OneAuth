import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, ctx, type TestUser } from '../helpers/fixtures';
import { download, secondBrowser, setUpVault, upload, type Browser } from '../helpers/cloud';
import * as vault from '@/lib/server/cloud/vault';
import * as items from '@/lib/server/cloud/items';
import * as rot from '@/lib/server/cloud/rotation';
import * as space from '@/lib/server/space';
import * as v from '@/lib/vault/crypto';
import { prepareRotation, rewrapBatch, startPayload } from '@/lib/vault/rotate';

beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

/** Two active browsers (A, B), one removed (C), files, a folder and a Space item, all under VK1. */
async function scenario() {
  const user = await createUser();
  const base = await setUpVault(user);
  const { a, vk, vaultId } = base;
  const approve = async (x: Browser) => {
    const reg = await vault.registerVaultDevice(await x.session(), { publicJwk: x.jwk }, ctx());
    await vault.approveVaultDevice(await a.session(), reg.id, { envelope: await v.wrapVaultKeyForDevice(vk, x.jwk), fingerprint: reg.fingerprint, keyVersion: 1 }, ctx());
    return reg.id;
  };
  const b = await secondBrowser(user);
  await approve(b);
  const c = await secondBrowser(user);
  const cId = await approve(c);
  // C keeps a copy of VK1, then is removed.
  const vkC = await v.unwrapVaultKeyForDevice((await vault.getVaultState(await c.session())).device!.envelope!, c.keys.privateKey);
  await vault.revokeVaultDevice(await a.session(), cId, ctx());

  const f1 = await upload(a, vk, new TextEncoder().encode('first file'));
  const f2 = await upload(a, vk, new TextEncoder().encode('second file'));
  const folderId = randomUUID();
  const nk = await v.deriveNameKey(vk, vaultId);
  await items.createFolder(await a.session(), { id: folderId, parentId: null, encryptedName: await v.sealJson(nk, 'folder', folderId, { name: 'Projects' }), keyVersion: 1 });
  const spaceId = (await space.listSpaces(await a.session())).spaces[0].id;
  const itemId = randomUUID();
  const sk = await v.deriveSpaceKey(vk, vaultId);
  await query(
    `insert into space_items (id, space_id, user_id, kind, encrypted_body) values ($1, $2, $3, 'bookmark', $4)`,
    [itemId, spaceId, user.userId, await v.sealJson(sk, 'space-item', itemId, { title: 'Docs', url: 'https://example.com' })],
  );
  return { user, ...base, b, c, vkC, f1, f2, folderId, itemId };
}

async function activeDevices(s: Awaited<ReturnType<Browser['session']>>) {
  return (await vault.getVaultState(s)).devices.filter((d) => d.status === 'active');
}

/** The browser loop: fetch work, re-wrap, submit, until nothing is left. */
async function drain(x: Browser, oldKey: Uint8Array, newKey: Uint8Array, vaultId: string, maxRounds = 20) {
  for (let i = 0; i < maxRounds; i++) {
    const work = await rot.rotationWork(await x.session());
    if (!work.files.length && !work.folders.length && !work.items.length) return work.remaining;
    await rot.submitRotationBatch(await x.session(), { rotationId: work.rotationId, ...(await rewrapBatch(work, oldKey, newKey, vaultId)) });
  }
  throw new Error('rotation did not drain');
}

async function start(x: Browser, user: TestUser, vaultId: string, reason = 'device_removed') {
  const prepared = await prepareRotation();
  const body = await startPayload(prepared, vaultId, await activeDevices(await x.session()));
  const res = await rot.startRotation(await x.session(), { reason, keyVersion: 1, ...body }, ctx());
  void user;
  return { prepared, res };
}

describe('vault-key rotation', () => {
  it('re-keys everything, reaches an offline browser, and retires the old vault key and recovery key', async () => {
    const s = await scenario();
    const { prepared, res } = await start(s.a, s.user, s.vaultId);
    expect(res).toMatchObject({ fromVersion: 1, toVersion: 2 });
    await drain(s.a, s.vk, prepared.vaultKey, s.vaultId);
    await rot.commitRotation(await s.a.session(), { rotationId: res.rotationId }, ctx());

    // B was "offline" throughout: it now unwraps VK2 from its own envelope and reads existing files.
    const stateB = await vault.getVaultState(await s.b.session());
    expect(stateB.vault!.key_version).toBe(2);
    const vkB = await v.unwrapVaultKeyForDevice(stateB.device!.envelope!, s.b.keys.privateKey);
    expect(vkB).toEqual(prepared.vaultKey);
    expect(new TextDecoder().decode((await download(s.b, vkB, s.f1.fileId)).plaintext)).toBe('first file');

    // No stored wrapped key, folder name or Space item opens with VK1 any more (C's copy is useless for them).
    const files = await query<{ wrapped_key: string; key_version: number }>(`select wrapped_key, key_version from cloud_files where user_id = $1`, [s.user.userId]);
    for (const f of files) {
      expect(f.key_version).toBe(2);
      await expect(v.unwrapFileKey(s.vkC, f.wrapped_key)).rejects.toThrow(v.VaultCryptoError);
    }
    const [folder] = await query<{ encrypted_name: string }>(`select encrypted_name from cloud_folders where id = $1`, [s.folderId]);
    await expect(v.openJson(await v.deriveNameKey(s.vkC, s.vaultId), 'folder', s.folderId, folder.encrypted_name)).rejects.toThrow();
    expect(await v.openJson(await v.deriveNameKey(vkB, s.vaultId), 'folder', s.folderId, folder.encrypted_name)).toEqual({ name: 'Projects' });
    const [item] = await query<{ encrypted_body: string }>(`select encrypted_body from space_items where id = $1`, [s.itemId]);
    expect(await v.openJson(await v.deriveSpaceKey(vkB, s.vaultId), 'space-item', s.itemId, item.encrypted_body)).toMatchObject({ title: 'Docs' });

    // The old recovery key no longer unlocks the vault; the new one does.
    const env = await vault.getRecoveryEnvelope(await s.a.session());
    await expect(v.unwrapVaultKeyForRecovery(env!.recovery_envelope, s.rk.bytes, s.vaultId)).rejects.toThrow(v.VaultCryptoError);
    expect(await v.unwrapVaultKeyForRecovery(env!.recovery_envelope, prepared.recovery.bytes, s.vaultId)).toEqual(prepared.vaultKey);

    // The removed browser gets nothing from the server either.
    expect((await vault.getVaultState(await s.c.session())).device).toBeNull();
    const events = await query<{ type: string }>(`select type from security_events where user_id = $1 and type like 'cloud.%rot%'`, [s.user.userId]);
    expect(events.map((e) => e.type).sort()).toEqual(['cloud.rotation_started', 'cloud.vault_rotated']);
  });

  it('resumes an interrupted rotation from another browser', async () => {
    const s = await scenario();
    const { prepared, res } = await start(s.a, s.user, s.vaultId);
    // A re-wraps only the files, then disappears (tab closed).
    const work = await rot.rotationWork(await s.a.session());
    const partial = await rewrapBatch({ ...work, folders: [], items: [] }, s.vk, prepared.vaultKey, s.vaultId);
    await rot.submitRotationBatch(await s.a.session(), { rotationId: res.rotationId, files: partial.files });
    await expect(rot.commitRotation(await s.a.session(), { rotationId: res.rotationId }, ctx())).rejects.toMatchObject({
      code: 'rotation_incomplete',
      detail: { files: 0, folders: 1, items: 1, devices: 0 },
    });

    // B finds the rotation, unwraps the new key from its own pending envelope, and finishes.
    const status = await rot.rotationStatus(await s.b.session());
    expect(status.rotation?.id).toBe(res.rotationId);
    const vk2 = await v.unwrapVaultKeyForDevice(status.rotation!.nextEnvelope!, s.b.keys.privateKey);
    const vk1 = await v.unwrapVaultKeyForDevice((await vault.getVaultState(await s.b.session())).device!.envelope!, s.b.keys.privateKey);
    await drain(s.b, vk1, vk2, s.vaultId);
    await rot.commitRotation(await s.b.session(), { rotationId: res.rotationId }, ctx());
    expect((await vault.getVaultState(await s.a.session())).vault!.key_version).toBe(2);
  });

  it('can be abandoned, leaving the current vault key and recovery key in force', async () => {
    const s = await scenario();
    const { prepared, res } = await start(s.a, s.user, s.vaultId);
    await drain(s.a, s.vk, prepared.vaultKey, s.vaultId);
    await rot.abortRotation(await s.a.session(), { rotationId: res.rotationId }, ctx());
    const leftovers = await query(
      `select 1 from cloud_files where next_wrapped_key is not null union all select 1 from vault_devices where next_envelope is not null
       union all select 1 from cloud_folders where next_encrypted_name is not null union all select 1 from space_items where next_encrypted_body is not null`,
    );
    expect(leftovers).toHaveLength(0);
    expect((await vault.getVaultState(await s.a.session())).vault!.key_version).toBe(1);
    expect(new TextDecoder().decode((await download(s.a, s.vk, s.f2.fileId)).plaintext)).toBe('second file');
    const env = await vault.getRecoveryEnvelope(await s.a.session());
    expect(await v.unwrapVaultKeyForRecovery(env!.recovery_envelope, s.rk.bytes, s.vaultId)).toEqual(s.vk);
    // A finished rotation can't be committed afterwards.
    await expect(rot.commitRotation(await s.a.session(), { rotationId: res.rotationId }, ctx())).rejects.toMatchObject({ code: 'no_rotation' });
  });

  it('blocks writes under the vault key during a rotation, and stale clients after it', async () => {
    const s = await scenario();
    const { prepared, res } = await start(s.a, s.user, s.vaultId);
    const fk = await v.generateFileKey();
    const fileId = randomUUID();
    const sa = await s.a.session();
    const meta = { fileId, folderId: null, size: 100, sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: await v.wrapFileKey(s.vk, fk) };
    await expect(items.initiateUpload(sa, { ...meta, keyVersion: 1 }, ctx())).rejects.toMatchObject({ code: 'rotation_in_progress' });
    await expect(
      items.createFolder(sa, { id: randomUUID(), parentId: null, encryptedName: 'A'.repeat(40), keyVersion: 1 }),
    ).rejects.toMatchObject({ code: 'rotation_in_progress' });
    // Writes that don't involve the vault key still work.
    await items.updateFile(sa, s.f1.fileId, { favorite: true }, ctx());
    // A pending browser can't be approved mid-rotation (it would only get the retiring key).
    const d = await secondBrowser(s.user);
    const reg = await vault.registerVaultDevice(await d.session(), { publicJwk: d.jwk }, ctx());
    await expect(
      vault.approveVaultDevice(sa, reg.id, { envelope: await v.wrapVaultKeyForDevice(s.vk, d.jwk), fingerprint: reg.fingerprint, keyVersion: 1 }, ctx()),
    ).rejects.toMatchObject({ code: 'rotation_in_progress' });

    await drain(s.a, s.vk, prepared.vaultKey, s.vaultId);
    await rot.commitRotation(sa, { rotationId: res.rotationId }, ctx());
    // A client still on VK1 is refused; one on VK2 proceeds, and the pending browser is approved with VK2.
    await expect(items.initiateUpload(sa, { ...meta, keyVersion: 1 }, ctx())).rejects.toMatchObject({ code: 'stale_key' });
    await items.initiateUpload(sa, { ...meta, wrappedKey: await v.wrapFileKey(prepared.vaultKey, fk), keyVersion: 2 }, ctx());
    await vault.approveVaultDevice(sa, reg.id, { envelope: await v.wrapVaultKeyForDevice(prepared.vaultKey, d.jwk), fingerprint: reg.fingerprint, keyVersion: 2 }, ctx());
  });

  it('refuses a start that misses an active browser, a second concurrent start, and a pending browser', async () => {
    const s = await scenario();
    const prepared = await prepareRotation();
    const active = await activeDevices(await s.a.session());
    const missing = await startPayload(prepared, s.vaultId, active.slice(0, 1));
    await expect(rot.startRotation(await s.a.session(), { reason: 'manual', keyVersion: 1, ...missing }, ctx())).rejects.toMatchObject({
      code: 'devices_changed',
    });
    const full = await startPayload(prepared, s.vaultId, active);
    const results = await Promise.allSettled([
      rot.startRotation(await s.a.session(), { reason: 'manual', keyVersion: 1, ...full }, ctx()),
      rot.startRotation(await s.b.session(), { reason: 'manual', keyVersion: 1, ...full }, ctx()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const pending = await secondBrowser(s.user);
    await vault.registerVaultDevice(await pending.session(), { publicJwk: pending.jwk }, ctx());
    await expect(rot.rotationWork(await pending.session())).rejects.toMatchObject({ code: 'vault_locked' });
  });

  it('never touches another account’s rows', async () => {
    const alice = await scenario();
    const bob = await scenario();
    const { prepared, res } = await start(bob.a, bob.user, bob.vaultId);
    // Bob submits Alice's file and folder IDs with junk keys: nothing of Alice's changes.
    const out = await rot.submitRotationBatch(await bob.a.session(), {
      rotationId: res.rotationId,
      files: [{ id: alice.f1.fileId, wrappedKey: 'B'.repeat(54) + '==' }],
      folders: [{ id: alice.folderId, encryptedName: 'B'.repeat(40) }],
    });
    expect(out.updated).toBe(0);
    expect(await query(`select 1 from cloud_files where id = $1 and next_wrapped_key is not null`, [alice.f1.fileId])).toHaveLength(0);
    await expect(rot.rotationWork(await alice.a.session())).rejects.toMatchObject({ code: 'no_rotation' });
    void prepared;
  });
});

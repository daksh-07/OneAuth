import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, ctx, stepUpSession } from '../helpers/fixtures';
import { secondBrowser, setUpVault, upload } from '../helpers/cloud';
import { revokeDevice } from '@/lib/server/devices';
import { RateLimitError } from '@/lib/server/ratelimit';
import * as vault from '@/lib/server/cloud/vault';
import * as items from '@/lib/server/cloud/items';
import { STALE_UPLOAD_HOURS } from '@/lib/server/cloud/quota';
import * as space from '@/lib/server/space';
import * as v from '@/lib/vault/crypto';

/**
 * Regression tests for defects found in the Phase 2B self-review (not an
 * independent audit). Each one failed against the earlier implementation.
 */
beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

const placeholder = { sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' };

describe('F1: abandoned uploads', () => {
  it('releases a stale reservation instead of blocking the account forever', async () => {
    const user = await createUser();
    const { a } = await setUpVault(user);
    const s = await a.session();
    const quota = (await vault.getVaultState(s)).usage.quota;
    const ids: string[] = [];
    // Reserve the whole allowance and walk away.
    while ((ids.length + 1) * items.MAX_OBJECT <= quota) {
      const fileId = randomUUID();
      await items.initiateUpload(s, { ...placeholder, fileId, folderId: null, size: items.MAX_OBJECT }, ctx());
      ids.push(fileId);
    }
    await expect(items.initiateUpload(s, { ...placeholder, fileId: randomUUID(), folderId: null, size: items.MAX_OBJECT }, ctx())).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    // A day later the abandoned uploads are released when the account next uploads.
    await query(`update cloud_files set updated_at = now() - make_interval(hours => $1 + 1) where user_id = $2`, [STALE_UPLOAD_HOURS, user.userId]);
    await items.initiateUpload(s, { ...placeholder, fileId: randomUUID(), folderId: null, size: items.MAX_OBJECT }, ctx());
    const usage = (await vault.getVaultState(s)).usage;
    expect(usage.reserved).toBe(items.MAX_OBJECT);
    expect(await query(`select 1 from cloud_files where id = any($1::uuid[])`, [ids])).toHaveLength(0);
  });

  it('caps the number of unfinished uploads', async () => {
    const user = await createUser();
    const { a } = await setUpVault(user);
    const s = await a.session();
    for (let i = 0; i < 20; i++) await items.initiateUpload(s, { ...placeholder, fileId: randomUUID(), folderId: null, size: 100 }, ctx());
    await expect(items.initiateUpload(s, { ...placeholder, fileId: randomUUID(), folderId: null, size: 100 }, ctx())).rejects.toMatchObject({
      code: 'too_many_uploads',
    });
  });
});

describe('F2: folder tree races', () => {
  async function folder(s: Awaited<ReturnType<Awaited<ReturnType<typeof setUpVault>>['a']['session']>>, nk: CryptoKey, parentId: string | null) {
    const id = randomUUID();
    await items.createFolder(s, { id, parentId, encryptedName: await v.sealJson(nk, 'folder', id, { name: 'x' }) });
    return id;
  }

  it('never lets two concurrent moves create a cycle', async () => {
    const user = await createUser();
    const { a, vk, vaultId } = await setUpVault(user);
    const s = await a.session();
    const nk = await v.deriveNameKey(vk, vaultId);
    for (let round = 0; round < 5; round++) {
      const x = await folder(s, nk, null);
      const y = await folder(s, nk, null);
      const results = await Promise.allSettled([items.updateFolder(s, x, { parentId: y }), items.updateFolder(s, y, { parentId: x })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rows = await query<{ id: string; parent_id: string | null }>(`select id, parent_id from cloud_folders where id = any($1::uuid[])`, [[x, y]]);
      expect(rows.some((r) => r.parent_id === null)).toBe(true);
    }
  });

  it('never deletes a file by cascading a folder deletion it was being moved into', async () => {
    const user = await createUser();
    const { a, vk, vaultId } = await setUpVault(user);
    const s = await a.session();
    const nk = await v.deriveNameKey(vk, vaultId);
    for (let round = 0; round < 5; round++) {
      const target = await folder(s, nk, null);
      const { fileId } = await upload(a, vk, new TextEncoder().encode(`file ${round}`));
      await Promise.allSettled([items.updateFile(s, fileId, { folderId: target }, ctx()), items.deleteFolder(s, target)]);
      // Either the move won (folder not empty, so not deleted) or the delete won (move refused): the file survives.
      expect(await query(`select 1 from cloud_files where id = $1`, [fileId])).toHaveLength(1);
    }
    const usage = (await vault.getVaultState(s)).usage;
    const stored = await query<{ n: string }>(`select coalesce(sum(size_bytes), 0) as n from cloud_files where user_id = $1`, [user.userId]);
    expect(usage.used).toBe(Number(stored[0].n));
  });
});

describe('F3: Space pins and vault access', () => {
  it('gives wrapped keys and encrypted metadata only to browsers with vault access', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const { fileId } = await upload(a, vk, new TextEncoder().encode('pinned'));
    const spaceId = (await space.listSpaces(await a.session())).spaces[0].id;
    await space.pinItem(await a.session(), spaceId, { fileId });
    expect((await space.listPins(await a.session(), spaceId)).files).toHaveLength(1);

    // A second browser that's signed in but not approved for the vault.
    const b = await secondBrowser(user);
    await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    const seen = await space.listPins(await b.session(), spaceId);
    expect(seen).toMatchObject({ files: [], folders: [], locked: true, lockedCount: 1 });
    expect(JSON.stringify(seen)).not.toContain(fileId);

    // And nobody gets it while Cloud is switched off.
    process.env.ONEAUTH_CLOUD_PREVIEW = '0';
    try {
      expect((await space.listPins(await a.session(), spaceId)).locked).toBe(true);
    } finally {
      process.env.ONEAUTH_CLOUD_PREVIEW = '1';
    }
  });
});

describe('F4/F5: enrolment authorisation', () => {
  it('stops a pending browser from removing approved browsers, but lets it withdraw itself', async () => {
    const user = await createUser();
    const { a } = await setUpVault(user);
    const aId = (await vault.getVaultState(await a.session())).device!.id;
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    await expect(vault.revokeVaultDevice(await b.session(), aId, ctx())).rejects.toMatchObject({ code: 'vault_locked' });
    expect((await vault.getVaultState(await a.session())).device?.status).toBe('active');
    await vault.revokeVaultDevice(await b.session(), reg.id, ctx());
    expect((await vault.getVaultState(await b.session())).device).toBeNull();
  });

  it('refuses to approve a request whose device has since been disconnected', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    const bDevice = (await b.session()).device_id;
    // Simulate a leftover request (e.g. written before the disconnect committed).
    await query(`update devices set revoked_at = now() where id = $1`, [bDevice]);
    await expect(
      vault.approveVaultDevice(await a.session(), reg.id, { envelope: await v.wrapVaultKeyForDevice(vk, b.jwk), fingerprint: reg.fingerprint }, ctx()),
    ).rejects.toMatchObject({ code: 'not_pending' });
    const row = await query<{ status: string }>(`select status from vault_devices where id = $1`, [reg.id]);
    expect(row[0].status).toBe('pending');
    void revokeDevice;
  });

  it('issues 60-bit security codes', async () => {
    const user = await createUser();
    await setUpVault(user);
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    expect(reg.fingerprint).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });
});

describe('F9: rate limits', () => {
  it('limits enrolment requests and recovery attempts per account', async () => {
    const user = await createUser();
    await setUpVault(user);
    const b = await secondBrowser(user);
    // Each new key re-registers; the eleventh in ten minutes is refused.
    let refused: unknown = null;
    for (let i = 0; i < 11 && !refused; i++) {
      const kp = await v.generateDeviceKeyPair();
      try {
        await vault.registerVaultDevice(await b.session(), { publicJwk: await v.exportPublicJwk(kp.publicKey) }, ctx());
      } catch (e) {
        refused = e;
      }
    }
    expect(refused).toBeInstanceOf(RateLimitError);

    const c = await secondBrowser(user);
    await query(`delete from rate_limits where key like 'cloud:register:%'`);
    await vault.registerVaultDevice(await c.session(), { publicJwk: c.jwk }, ctx());
    const fresh = await stepUpSession(user, await c.session());
    void fresh;
    const wrong = await v.generateRecoveryKey();
    const env = await v.wrapVaultKeyForDevice(v.generateVaultKey(), c.jwk);
    let limited: unknown = null;
    for (let i = 0; i < 11 && !limited; i++) {
      try {
        await vault.recoverVaultDevice(await c.session(), { envelope: env, recoveryProof: await v.recoveryProof(wrong.bytes, randomUUID()) }, ctx());
      } catch (e) {
        if (e instanceof RateLimitError) limited = e;
      }
    }
    expect(limited).toBeInstanceOf(RateLimitError);
  });
});

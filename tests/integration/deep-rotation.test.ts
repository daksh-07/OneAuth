import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, ctx } from '../helpers/fixtures';
import { download, secondBrowser, setUpVault, upload, type Browser } from '../helpers/cloud';
import * as vault from '@/lib/server/cloud/vault';
import * as items from '@/lib/server/cloud/items';
import * as rot from '@/lib/server/cloud/rotation';
import * as space from '@/lib/server/space';
import { PART_SIZE } from '@/lib/server/cloud/storage';
import * as v from '@/lib/vault/crypto';
import { prepareRotation, rewrapBatch, startPayload } from '@/lib/vault/rotate';

beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

/** The browser's re-encryption: decrypt with the current key, encrypt under a new file key and ID, upload as a replacement. */
async function reencrypt(b: Browser, vk: Uint8Array, keyVersion: number, fileId: string, opts: { stopBeforeComplete?: boolean } = {}) {
  const { plaintext, meta } = await download(b, vk, fileId);
  const row = (await items.listItems(await b.session(), { folderId: null, view: 'all' })).files.find((f) => f.id === fileId)!;
  const newId = randomUUID();
  const fk = await v.generateFileKey();
  const object = await v.encryptFile(fk, newId, plaintext);
  const s = await b.session();
  const { partCount } = await items.initiateUpload(
    s,
    {
      fileId: newId,
      folderId: row.folder_id,
      size: object.length,
      sha256: Buffer.from(await v.sha256(object)).toString('hex'),
      encryptedMeta: await v.sealJson(fk, 'meta', newId, meta),
      wrappedKey: await v.wrapFileKey(vk, fk),
      keyVersion,
      replacesFileId: fileId,
    },
    ctx(),
  );
  for (let i = 0; i < partCount; i++) await items.putPart(s, newId, String(i), object.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
  if (!opts.stopBeforeComplete) await items.completeUpload(s, newId, ctx());
  return newId;
}

/** A, with B removed after keeping VK1 and the wrapped key of an existing file; then a (shallow) rotation to VK2. */
async function afterRotation() {
  const user = await createUser();
  const base = await setUpVault(user);
  const doc = new TextEncoder().encode('existing file contents, encrypted before the rotation');
  const f = await upload(base.a, base.vk, doc);
  // What a browser that is later removed could have kept: VK1 and the file's wrapped key (and so its file key).
  const [row] = await query<{ wrapped_key: string }>(`select wrapped_key from cloud_files where id = $1`, [f.fileId]);
  const keptFileKey = await v.unwrapFileKey(base.vk, row.wrapped_key);
  const prepared = await prepareRotation();
  const active = (await vault.getVaultState(await base.a.session())).devices.filter((d) => d.status === 'active');
  const body = await startPayload(prepared, base.vaultId, active, { oldKey: base.vk, fromVersion: 1 });
  const { rotationId } = await rot.startRotation(await base.a.session(), { reason: 'device_removed', keyVersion: 1, ...body }, ctx());
  const work = await rot.rotationWork(await base.a.session());
  await rot.submitRotationBatch(await base.a.session(), { rotationId, ...(await rewrapBatch(work, base.vk, prepared.vaultKey, base.vaultId)) });
  await rot.commitRotation(await base.a.session(), { rotationId }, ctx());
  return { user, ...base, vk2: prepared.vaultKey, doc, fileId: f.fileId, keptFileKey };
}

async function storedObject(fileId: string) {
  const parts = await query<{ data: Buffer }>(`select data from cloud_object_parts where file_id = $1 order by idx`, [fileId]);
  return new Uint8Array(Buffer.concat(parts.map((p) => p.data)));
}

describe('deep rotation (re-encrypting existing contents)', () => {
  it('closes the gap rotation leaves: kept file keys no longer open the stored contents', async () => {
    const s = await afterRotation();
    // Shallow rotation alone: the removed browser's kept file key still decrypts the stored ciphertext.
    expect(new TextDecoder().decode(await v.decryptFile(s.keptFileKey, s.fileId, await storedObject(s.fileId)))).toContain('existing file');
    const stale = await items.staleContent(await s.a.session());
    expect(stale.files.map((f) => f.id)).toEqual([s.fileId]);

    const newId = await reencrypt(s.a, s.vk2, 2, s.fileId);
    // The old object is gone; the new one opens only with its new file key.
    expect(await storedObject(s.fileId)).toHaveLength(0);
    const fresh = await storedObject(newId);
    await expect(v.decryptFile(s.keptFileKey, newId, fresh)).rejects.toThrow(v.VaultCryptoError);
    await expect(v.decryptFile(s.keptFileKey, s.fileId, fresh)).rejects.toThrow(v.VaultCryptoError);
    expect(Buffer.from((await download(s.a, s.vk2, newId)).plaintext).equals(Buffer.from(s.doc))).toBe(true);
    expect((await items.staleContent(await s.a.session())).files).toHaveLength(0);
  });

  it('keeps the file’s place: folder, favourite, pins and quota carry over exactly', async () => {
    const s = await afterRotation();
    const sa = await s.a.session();
    await items.updateFile(sa, s.fileId, { favorite: true }, ctx());
    const spaceId = (await space.listSpaces(sa)).spaces[0].id;
    await space.pinItem(sa, spaceId, { fileId: s.fileId });
    const before = (await vault.getVaultState(sa)).usage;

    const newId = await reencrypt(s.a, s.vk2, 2, s.fileId);
    const [row] = await query<{ favorite: boolean; status: string; content_version: number }>(
      `select favorite, status, content_version from cloud_files where id = $1`,
      [newId],
    );
    expect(row).toEqual({ favorite: true, status: 'ready', content_version: 2 });
    const pins = await space.listPins(sa, spaceId);
    expect(pins.files.map((f) => f.id)).toEqual([newId]);
    const after = (await vault.getVaultState(sa)).usage;
    expect(after).toMatchObject({ used: before.used, reserved: 0 }); // same size: one file replaced by one file
  });

  it('is interruptible: until it completes, the original stays and is still the one listed', async () => {
    const s = await afterRotation();
    const newId = await reencrypt(s.a, s.vk2, 2, s.fileId, { stopBeforeComplete: true });
    const listed = await items.listItems(await s.a.session(), { folderId: null, view: 'folder' });
    expect(listed.files.map((f) => f.id)).toEqual([s.fileId]);
    expect(new TextDecoder().decode((await download(s.a, s.vk2, s.fileId)).plaintext)).toContain('existing file');
    // Cancelling the replacement releases its reservation and leaves the original untouched.
    await items.deleteFile(await s.a.session(), newId, ctx());
    expect((await vault.getVaultState(await s.a.session())).usage.reserved).toBe(0);
    expect(await query(`select 1 from cloud_files where id = $1 and status = 'ready'`, [s.fileId])).toHaveLength(1);
  });

  it('runs at most one re-encryption per file, and refuses if the original changed or vanished meanwhile', async () => {
    const s = await afterRotation();
    const first = await reencrypt(s.a, s.vk2, 2, s.fileId, { stopBeforeComplete: true });
    await expect(reencrypt(s.a, s.vk2, 2, s.fileId, { stopBeforeComplete: true })).rejects.toMatchObject({ code: 'conflict' });
    // A rename on another browser while this one re-encrypts: the swap is refused, nothing is lost.
    const [meta] = await query<{ encrypted_meta: string }>(`select encrypted_meta from cloud_files where id = $1`, [s.fileId]);
    await items.updateFile(await s.a.session(), s.fileId, { encryptedMeta: meta.encrypted_meta }, ctx());
    await expect(items.completeUpload(await s.a.session(), first, ctx())).rejects.toMatchObject({ code: 'changed_during_reencrypt' });
    expect(await query(`select 1 from cloud_files where id = $1 and status = 'ready'`, [s.fileId])).toHaveLength(1);
    await items.deleteFile(await s.a.session(), first, ctx());
    // Original deleted mid-way: refused, and the replacement can be cancelled.
    const second = await reencrypt(s.a, s.vk2, 2, s.fileId, { stopBeforeComplete: true });
    await items.deleteFile(await s.a.session(), s.fileId, ctx());
    await expect(items.completeUpload(await s.a.session(), second, ctx())).rejects.toMatchObject({ code: 'replace_target_gone' });
  });

  it('can only replace the account’s own ready files', async () => {
    const s = await afterRotation();
    const other = await createUser('Other');
    const o = await setUpVault(other);
    const fk = await v.generateFileKey();
    await expect(
      items.initiateUpload(
        await o.a.session(),
        {
          fileId: randomUUID(),
          folderId: null,
          size: 100,
          sha256: '0'.repeat(64),
          encryptedMeta: 'A'.repeat(40),
          wrappedKey: await v.wrapFileKey(o.vk, fk),
          keyVersion: 1,
          replacesFileId: s.fileId,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    void secondBrowser;
  });
});

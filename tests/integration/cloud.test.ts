import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, ctx, signIn, type TestUser } from '../helpers/fixtures';
import { validateSessionToken, type SessionRecord } from '@/lib/server/sessions';
import { revokeDevice } from '@/lib/server/devices';
import * as vault from '@/lib/server/cloud/vault';
import * as items from '@/lib/server/cloud/items';
import { PART_SIZE } from '@/lib/server/cloud/storage';
import * as v from '@/lib/vault/crypto';

beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

/** A browser: a OneAuth session plus its own non-extractable device key. */
interface Browser {
  session: () => Promise<SessionRecord>;
  keys: CryptoKeyPair;
  jwk: v.PublicDeviceJwk;
}

async function browserFor(token: string): Promise<Browser> {
  const keys = await v.generateDeviceKeyPair();
  return { session: async () => (await validateSessionToken(token))!, keys, jwk: await v.exportPublicJwk(keys.publicKey) };
}

async function setUpVault(user: TestUser) {
  const a = await browserFor(user.token);
  const vk = v.generateVaultKey();
  const vaultId = randomUUID();
  const rk = await v.generateRecoveryKey();
  await vault.createVault(
    await a.session(),
    {
      vaultId,
      recoveryEnvelope: await v.wrapVaultKeyForRecovery(vk, rk.bytes, vaultId),
      recoveryProof: await v.recoveryProof(rk.bytes, vaultId),
      publicJwk: a.jwk,
      envelope: await v.wrapVaultKeyForDevice(vk, a.jwk),
    },
    ctx(),
  );
  return { a, vk, vaultId, rk };
}

async function secondBrowser(user: TestUser) {
  const res = await signIn(user);
  return browserFor(res.token);
}

/** Encrypts and uploads through the same protocol the UI uses. */
async function upload(b: Browser, vk: Uint8Array, plaintext: Uint8Array, opts: { name?: string; folderId?: string | null } = {}) {
  const fileId = randomUUID();
  const fk = await v.generateFileKey();
  const object = await v.encryptFile(fk, fileId, plaintext);
  const s = await b.session();
  const { partCount } = await items.initiateUpload(
    s,
    {
      fileId,
      folderId: opts.folderId ?? null,
      size: object.length,
      sha256: Buffer.from(await v.sha256(object)).toString('hex'),
      encryptedMeta: await v.sealJson(fk, 'meta', fileId, { name: opts.name ?? 'notes.txt', type: 'text/plain', size: plaintext.length }),
      wrappedKey: await v.wrapFileKey(vk, fk),
    },
    ctx(),
  );
  for (let i = 0; i < partCount; i++) await items.putPart(s, fileId, String(i), object.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
  await items.completeUpload(s, fileId, ctx());
  return { fileId, object };
}

async function download(b: Browser, vkOrEnvelope: Uint8Array, fileId: string) {
  const s = await b.session();
  const list = await items.listItems(s, { folderId: null, view: 'recent' });
  const row = list.files.find((f) => f.id === fileId)!;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < row.part_count; i++) parts.push(await items.getPart(s, fileId, String(i)));
  const object = new Uint8Array(Buffer.concat(parts));
  const fk = await v.unwrapFileKey(vkOrEnvelope, row.wrapped_key);
  return { plaintext: await v.decryptFile(fk, fileId, object), meta: await v.openJson<{ name: string }>(fk, 'meta', fileId, row.encrypted_meta) };
}

describe('vault enrolment', () => {
  it('moves a file end-to-end between two approved devices', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const secret = new TextEncoder().encode('test file contents '.repeat(100_000)); // > 1 MiB: several parts
    const { fileId, object } = await upload(a, vk, secret);

    // The server holds ciphertext only.
    const stored = await query<{ data: Buffer }>(`select data from cloud_object_parts where file_id = $1 order by idx`, [fileId]);
    expect(Buffer.concat(stored.map((r) => r.data)).equals(Buffer.from(object))).toBe(true);
    expect(Buffer.concat(stored.map((r) => r.data)).includes(Buffer.from('test file contents'))).toBe(false);

    // Device B registers, is pending and gets nothing.
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    expect(reg.status).toBe('pending');
    await expect(items.getPart(await b.session(), fileId, '0')).rejects.toMatchObject({ code: 'vault_locked' });
    expect((await vault.getVaultState(await b.session())).device?.envelope).toBeNull();

    // A sees the pending request, recomputes the fingerprint from the returned key, and approves.
    const stateA = await vault.getVaultState(await a.session());
    const pending = stateA.devices.find((d) => d.status === 'pending')!;
    const shown = await v.deviceFingerprint(pending.public_jwk);
    expect(shown).toBe(reg.fingerprint);
    await vault.approveVaultDevice(
      await a.session(),
      pending.id,
      { envelope: await v.wrapVaultKeyForDevice(vk, pending.public_jwk), fingerprint: shown },
      ctx(),
    );

    // B unwraps the vault key with its own private key and decrypts the file.
    const envelope = (await vault.getVaultState(await b.session())).device!.envelope!;
    const vkB = await v.unwrapVaultKeyForDevice(envelope, b.keys.privateKey);
    const got = await download(b, vkB, fileId);
    expect(Buffer.from(got.plaintext).equals(Buffer.from(secret))).toBe(true);
    expect(got.meta.name).toBe('notes.txt');
  });

  it('refuses an approval whose fingerprint doesn’t match (key substitution)', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    await expect(
      vault.approveVaultDevice(await a.session(), reg.id, { envelope: await v.wrapVaultKeyForDevice(vk, b.jwk), fingerprint: 'AAAA-AAAA' }, ctx()),
    ).rejects.toMatchObject({ code: 'fingerprint_mismatch' });
  });

  it('lets a pending device approve nothing and only the recovery key self-activate it', async () => {
    const user = await createUser();
    const { vk, vaultId, rk } = await setUpVault(user);
    const b = await secondBrowser(user);
    const c = await secondBrowser(user);
    await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    const regC = await vault.registerVaultDevice(await c.session(), { publicJwk: c.jwk }, ctx());
    // B is pending: can't approve C and can't see it.
    expect((await vault.getVaultState(await b.session())).devices.map((d) => d.id)).not.toContain(regC.id);
    await expect(
      vault.approveVaultDevice(await b.session(), regC.id, { envelope: await v.wrapVaultKeyForDevice(vk, c.jwk), fingerprint: regC.fingerprint }, ctx()),
    ).rejects.toMatchObject({ code: 'vault_locked' });

    // Recovery with the wrong key is refused, even with a well-formed envelope.
    const wrong = await v.generateRecoveryKey();
    const bogus = await v.wrapVaultKeyForDevice(v.generateVaultKey(), b.jwk);
    await expect(
      vault.recoverVaultDevice(await b.session(), { envelope: bogus, recoveryProof: await v.recoveryProof(wrong.bytes, vaultId) }, ctx()),
    ).rejects.toMatchObject({ code: 'recovery_mismatch' });

    // With the real recovery key: unwrap locally, re-wrap to own key, activate.
    const env = await vault.getRecoveryEnvelope(await b.session());
    const recovered = await v.unwrapVaultKeyForRecovery(env!.recovery_envelope, rk.bytes, env!.vault_id);
    expect(recovered).toEqual(vk);
    await vault.recoverVaultDevice(
      await b.session(),
      { envelope: await v.wrapVaultKeyForDevice(recovered, b.jwk), recoveryProof: await v.recoveryProof(rk.bytes, vaultId) },
      ctx(),
    );
    expect((await vault.getVaultState(await b.session())).device?.status).toBe('active');
    const events = await query<{ type: string }>(`select type from security_events where user_id = $1 and type like 'cloud.%'`, [user.userId]);
    expect(events.map((e) => e.type)).toContain('cloud.recovery_used');
  });

  it('allows one vault per account and needs a fresh passkey confirmation to create it', async () => {
    const user = await createUser();
    await setUpVault(user);
    await expect(setUpVault(user)).rejects.toMatchObject({ code: 'vault_exists' });
    const other = await createUser('Sam');
    await query(`update sessions set reauth_at = now() - interval '1 hour' where user_id = $1`, [other.userId]);
    await expect(setUpVault(other)).rejects.toMatchObject({ code: 'reauth_required' });
  });
});

describe('access control', () => {
  it('blocks a revoked device, including when disconnected in Devices', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const { fileId } = await upload(a, vk, new TextEncoder().encode('hello'));
    const b = await secondBrowser(user);
    const reg = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    await vault.approveVaultDevice(await a.session(), reg.id, { envelope: await v.wrapVaultKeyForDevice(vk, b.jwk), fingerprint: reg.fingerprint }, ctx());
    expect((await items.getPart(await b.session(), fileId, '0')).length).toBeGreaterThan(0);

    await vault.revokeVaultDevice(await a.session(), reg.id, ctx());
    await expect(items.getPart(await b.session(), fileId, '0')).rejects.toMatchObject({ code: 'vault_locked' });
    expect((await vault.getVaultState(await b.session())).device).toBeNull();

    // Re-register and approve, then disconnect the whole device.
    const reg2 = await vault.registerVaultDevice(await b.session(), { publicJwk: b.jwk }, ctx());
    await vault.approveVaultDevice(await a.session(), reg2.id, { envelope: await v.wrapVaultKeyForDevice(vk, b.jwk), fingerprint: reg2.fingerprint }, ctx());
    const bDevice = (await b.session()).device_id;
    await revokeDevice(user.userId, bDevice, (await a.session()).id, ctx());
    const row = await query<{ status: string; envelope: string | null }>(`select status, envelope from vault_devices where device_id = $1`, [bDevice]);
    expect(row.every((r) => r.status === 'revoked' && r.envelope === null)).toBe(true);
  });

  it('keeps Cloud off for shared devices, when the preview flag is off, and in production', async () => {
    const user = await createUser('Kiosk user', { shared: true });
    await expect(vault.getVaultState(await user.session())).rejects.toMatchObject({ code: 'forbidden' });
    const owner = await createUser();
    process.env.ONEAUTH_CLOUD_PREVIEW = '0';
    await expect(vault.getVaultState(await owner.session())).rejects.toMatchObject({ code: 'cloud_unavailable' });
    process.env.ONEAUTH_CLOUD_PREVIEW = '1';
    process.env.VERCEL_ENV = 'production';
    try {
      await expect(vault.getVaultState(await owner.session())).rejects.toMatchObject({ code: 'cloud_unavailable' });
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  it('isolates users: another account can’t read, change or delete a file by ID', async () => {
    const alice = await createUser('Alice');
    const { a, vk } = await setUpVault(alice);
    const { fileId } = await upload(a, vk, new TextEncoder().encode('alice only'));
    const bob = await createUser('Bob');
    const { a: bobBrowser } = await setUpVault(bob);
    const s = await bobBrowser.session();
    await expect(items.getPart(s, fileId, '0')).rejects.toMatchObject({ code: 'not_found' });
    await expect(items.updateFile(s, fileId, { trashed: true }, ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(items.deleteFile(s, fileId, ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect((await items.listItems(s, { folderId: null, view: 'recent' })).files).toHaveLength(0);
    // Reusing Alice's file ID for Bob's upload doesn't overwrite it.
    await expect(
      items.initiateUpload(
        s,
        { fileId, folderId: null, size: 100, sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' },
        ctx(),
      ),
    ).rejects.toThrow();
  });
});

describe('quota and upload integrity', () => {
  it('reserves at start, refuses uploads past the allowance, and releases on cancel and delete', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const s = await a.session();
    const quota = (await vault.getVaultState(s)).usage.quota;
    const big = { folderId: null, sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' };
    // Fill most of the allowance with reservations (preview per-file cap).
    const reservations: string[] = [];
    let reserved = 0;
    while (reserved + items.MAX_OBJECT <= quota) {
      const id = randomUUID();
      await items.initiateUpload(s, { ...big, fileId: id, size: items.MAX_OBJECT }, ctx());
      reservations.push(id);
      reserved += items.MAX_OBJECT;
    }
    await expect(items.initiateUpload(s, { ...big, fileId: randomUUID(), size: items.MAX_OBJECT }, ctx())).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect((await vault.getVaultState(s)).usage.reserved).toBe(reserved);
    for (const id of reservations) await items.deleteFile(s, id, ctx());
    expect((await vault.getVaultState(s)).usage).toMatchObject({ reserved: 0, used: 0 });

    const { fileId, object } = await upload(a, vk, new TextEncoder().encode('counted'));
    expect((await vault.getVaultState(s)).usage).toMatchObject({ used: object.length, reserved: 0 });
    await items.deleteFile(s, fileId, ctx());
    expect((await vault.getVaultState(s)).usage.used).toBe(0);
    expect(await query(`select 1 from cloud_object_parts where file_id = $1`, [fileId])).toHaveLength(0);
  });

  it('can’t be raced past the quota by concurrent uploads', async () => {
    const user = await createUser();
    const { a } = await setUpVault(user);
    const s = await a.session();
    const quota = (await vault.getVaultState(s)).usage.quota;
    const n = Math.floor(quota / items.MAX_OBJECT) + 3;
    const results = await Promise.allSettled(
      Array.from({ length: n }, () =>
        items.initiateUpload(
          s,
          { fileId: randomUUID(), folderId: null, size: items.MAX_OBJECT, sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' },
          ctx(),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(Math.floor(quota / items.MAX_OBJECT));
    const usage = (await vault.getVaultState(s)).usage;
    expect(usage.reserved).toBeLessThanOrEqual(quota);
  });

  it('rejects oversized declarations, wrong part sizes and tampered uploads', async () => {
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    const s = await a.session();
    const base = { folderId: null, sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' };
    await expect(items.initiateUpload(s, { ...base, fileId: randomUUID(), size: items.MAX_OBJECT + 1 }, ctx())).rejects.toMatchObject({ code: 'too_large' });
    await expect(items.initiateUpload(s, { ...base, fileId: randomUUID(), size: -5 }, ctx())).rejects.toMatchObject({ code: 'too_large' });

    // Declared hash doesn't match what arrives.
    const fileId = randomUUID();
    const fk = await v.generateFileKey();
    const object = await v.encryptFile(fk, fileId, new TextEncoder().encode('original'));
    await items.initiateUpload(
      s,
      {
        fileId,
        folderId: null,
        size: object.length,
        sha256: Buffer.from(await v.sha256(object)).toString('hex'),
        encryptedMeta: await v.sealJson(fk, 'meta', fileId, { name: 'x' }),
        wrappedKey: await v.wrapFileKey(vk, fk),
      },
      ctx(),
    );
    await expect(items.putPart(s, fileId, '0', object.subarray(1))).rejects.toMatchObject({ code: 'invalid_part' });
    await expect(items.putPart(s, fileId, '1', object)).rejects.toMatchObject({ code: 'invalid' });
    await expect(items.completeUpload(s, fileId, ctx())).rejects.toMatchObject({ code: 'integrity_mismatch' });
    const tampered = new Uint8Array(object);
    tampered[30] ^= 1;
    await items.putPart(s, fileId, '0', tampered);
    await expect(items.completeUpload(s, fileId, ctx())).rejects.toMatchObject({ code: 'integrity_mismatch' });
    // An unfinished upload is never listed or downloadable.
    await expect(items.getPart(s, fileId, '0')).rejects.toMatchObject({ code: 'not_found' });
    await items.putPart(s, fileId, '0', object);
    await items.completeUpload(s, fileId, ctx());
    expect((await download(a, vk, fileId)).meta.name).toBe('x');
  });
});

describe('account deletion', () => {
  it('removes the vault, files, ciphertext and usage with the account', async () => {
    const { deleteAccount } = await import('@/lib/server/account');
    const user = await createUser();
    const { a, vk } = await setUpVault(user);
    await upload(a, vk, new TextEncoder().encode('to be deleted'));
    await deleteAccount(await a.session(), 'delete my account');
    for (const t of ['vaults', 'vault_devices', 'cloud_files', 'cloud_object_parts', 'storage_usage']) {
      expect(await query(`select 1 from ${t} where user_id = $1`, [user.userId])).toHaveLength(0);
    }
  });
});

describe('folders, trash and favourites', () => {
  it('organises files and prevents folder cycles', async () => {
    const user = await createUser();
    const { a, vk, vaultId } = await setUpVault(user);
    const s = await a.session();
    const nk = await v.deriveNameKey(vk, vaultId);
    const mk = async (parentId: string | null, name: string) => {
      const id = randomUUID();
      await items.createFolder(s, { id, parentId, encryptedName: await v.sealJson(nk, 'folder', id, { name }) });
      return id;
    };
    const docs = await mk(null, 'Docs');
    const sub = await mk(docs, 'Sub');
    const deep = await mk(sub, 'Deep');
    await expect(items.updateFolder(s, docs, { parentId: deep })).rejects.toMatchObject({ code: 'invalid_move' });
    await expect(items.updateFolder(s, docs, { parentId: docs })).rejects.toMatchObject({ code: 'invalid_move' });

    const { fileId } = await upload(a, vk, new TextEncoder().encode('in a folder'), { folderId: sub });
    const view = await items.listItems(s, { folderId: sub, view: 'folder' });
    expect(view.files.map((f) => f.id)).toEqual([fileId]);
    expect(view.folders.map((f) => f.id)).toEqual([deep]);
    expect(view.path.map((f) => f.id)).toEqual([docs, sub]);
    const names = await Promise.all(view.path.map((f) => v.openJson<{ name: string }>(nk, 'folder', f.id, f.encrypted_name)));
    expect(names.map((n) => n.name)).toEqual(['Docs', 'Sub']);

    await items.updateFile(s, fileId, { favorite: true }, ctx());
    expect((await items.listItems(s, { folderId: null, view: 'favorites' })).files).toHaveLength(1);
    await items.updateFile(s, fileId, { trashed: true }, ctx());
    expect((await items.listItems(s, { folderId: sub, view: 'folder' })).files).toHaveLength(0);
    expect((await items.listItems(s, { folderId: null, view: 'trash' })).files).toHaveLength(1);
    await items.updateFile(s, fileId, { trashed: false, folderId: null }, ctx());
    expect((await items.listItems(s, { folderId: null, view: 'folder' })).files).toHaveLength(1);

    // Files inside a trashed folder disappear from Recent and Favourites, and come back with it.
    await items.updateFile(s, fileId, { folderId: deep }, ctx());
    await items.updateFolder(s, sub, { trashed: true });
    expect((await items.listItems(s, { folderId: null, view: 'recent' })).files).toHaveLength(0);
    expect((await items.listItems(s, { folderId: null, view: 'favorites' })).files).toHaveLength(0);
    await items.updateFolder(s, sub, { trashed: false });
    expect((await items.listItems(s, { folderId: null, view: 'recent' })).files).toHaveLength(1);
    // Restoring a file whose folder is in the trash puts it at the top level.
    await items.updateFile(s, fileId, { trashed: true }, ctx());
    await items.updateFolder(s, deep, { trashed: true });
    await items.updateFile(s, fileId, { trashed: false }, ctx());
    expect((await items.listItems(s, { folderId: null, view: 'folder' })).files.map((f) => f.id)).toContain(fileId);
    await items.updateFolder(s, deep, { trashed: false });
    await items.updateFile(s, fileId, { folderId: sub }, ctx());

    await expect(items.deleteFolder(s, sub)).rejects.toMatchObject({ code: 'not_empty' });
    await items.updateFile(s, fileId, { folderId: null }, ctx());
    await items.deleteFolder(s, deep);
    await items.deleteFolder(s, sub);
    // Uploading into a trashed folder is refused.
    await items.updateFolder(s, docs, { trashed: true });
    await expect(upload(a, vk, new TextEncoder().encode('x'), { folderId: docs })).rejects.toMatchObject({ code: 'not_found' });
  });
});

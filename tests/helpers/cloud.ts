import { randomUUID } from 'node:crypto';
import { ctx, signIn, type TestUser } from './fixtures';
import { validateSessionToken, type SessionRecord } from '@/lib/server/sessions';
import * as vault from '@/lib/server/cloud/vault';
import * as items from '@/lib/server/cloud/items';
import { PART_SIZE } from '@/lib/server/cloud/storage';
import * as v from '@/lib/vault/crypto';

/** Shared by the Cloud, Space and rotation integration tests: real browser-side crypto, server-side API. */
/** A browser: a OneAuth session plus its own non-extractable device key. */
export interface Browser {
  session: () => Promise<SessionRecord>;
  keys: CryptoKeyPair;
  jwk: v.PublicDeviceJwk;
}

export async function browserFor(token: string): Promise<Browser> {
  const keys = await v.generateDeviceKeyPair();
  return { session: async () => (await validateSessionToken(token))!, keys, jwk: await v.exportPublicJwk(keys.publicKey) };
}

export async function setUpVault(user: TestUser) {
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

export async function secondBrowser(user: TestUser) {
  const res = await signIn(user);
  return browserFor(res.token);
}

/** Encrypts and uploads through the same protocol the UI uses. */
export async function upload(b: Browser, vk: Uint8Array, plaintext: Uint8Array, opts: { name?: string; folderId?: string | null } = {}) {
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
      keyVersion: 1,
    },
    ctx(),
  );
  for (let i = 0; i < partCount; i++) await items.putPart(s, fileId, String(i), object.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
  await items.completeUpload(s, fileId, ctx());
  return { fileId, object };
}

export async function download(b: Browser, vkOrEnvelope: Uint8Array, fileId: string) {
  const s = await b.session();
  const list = await items.listItems(s, { folderId: null, view: 'recent' });
  const row = list.files.find((f) => f.id === fileId)!;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < row.part_count; i++) parts.push(await items.getPart(s, fileId, String(i)));
  const object = new Uint8Array(Buffer.concat(parts));
  const fk = await v.unwrapFileKey(vkOrEnvelope, row.wrapped_key);
  return { plaintext: await v.decryptFile(fk, fileId, object), meta: await v.openJson<{ name: string }>(fk, 'meta', fileId, row.encrypted_meta) };
}


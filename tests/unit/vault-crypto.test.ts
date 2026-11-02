import { describe, expect, it } from 'vitest';
import * as v from '@/lib/vault/crypto';

const FILE_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const OTHER_ID = '00000000-0000-4000-8000-000000000001';
const VAULT_ID = '11111111-2222-4333-8444-555555555555';

function bytes(n: number) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255;
  return b;
}

describe('file encryption (OAC1)', () => {
  for (const size of [0, 1, 1024, v.CHUNK_SIZE - 1, v.CHUNK_SIZE, v.CHUNK_SIZE + 1, 2 * v.CHUNK_SIZE + 12345]) {
    it(`round-trips ${size} bytes with the predicted ciphertext size`, async () => {
      const fk = await v.generateFileKey();
      const pt = bytes(size);
      const ct = await v.encryptFile(fk, FILE_ID, pt);
      expect(ct.length).toBe(v.encryptedSize(size));
      expect(await v.decryptFile(fk, FILE_ID, ct)).toEqual(pt);
    });
  }

  it('never contains the plaintext and uses fresh nonces', async () => {
    const fk = await v.generateFileKey();
    const pt = new TextEncoder().encode('TOP SECRET PLAINTEXT MARKER '.repeat(100));
    const a = await v.encryptFile(fk, FILE_ID, pt);
    const b = await v.encryptFile(fk, FILE_ID, pt);
    expect(Buffer.from(a).includes(Buffer.from('TOP SECRET'))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects any flipped bit (header, nonce, ciphertext or tag)', async () => {
    const fk = await v.generateFileKey();
    const ct = await v.encryptFile(fk, FILE_ID, bytes(5000));
    // Every header byte, then samples across nonce, ciphertext and tag.
    for (const pos of [...Array.from({ length: 16 }, (_, i) => i), 16, 20, 27, 28, 40, ct.length - 17, ct.length - 1]) {
      const t = ct.slice();
      t[pos] ^= 1;
      await expect(v.decryptFile(fk, FILE_ID, t)).rejects.toThrow(v.VaultCryptoError);
    }
  });

  it('rejects the wrong key and the wrong file ID (no splicing between files)', async () => {
    const fk = await v.generateFileKey();
    const ct = await v.encryptFile(fk, FILE_ID, bytes(100));
    await expect(v.decryptFile(await v.generateFileKey(), FILE_ID, ct)).rejects.toThrow(v.VaultCryptoError);
    await expect(v.decryptFile(fk, OTHER_ID, ct)).rejects.toThrow(v.VaultCryptoError);
  });

  it('rejects truncation, extension and chunk reordering', async () => {
    const fk = await v.generateFileKey();
    const ct = await v.encryptFile(fk, FILE_ID, bytes(3 * v.CHUNK_SIZE));
    await expect(v.decryptFile(fk, FILE_ID, ct.subarray(0, ct.length - 1))).rejects.toThrow();
    const full = 12 + v.CHUNK_SIZE + 16;
    // Drop the last chunk but keep a valid-looking length.
    await expect(v.decryptFile(fk, FILE_ID, ct.subarray(0, 16 + 2 * full))).rejects.toThrow();
    await expect(v.decryptFile(fk, FILE_ID, Uint8Array.from([...ct, 0]))).rejects.toThrow();
    const swapped = ct.slice();
    swapped.set(ct.subarray(16 + full, 16 + 2 * full), 16);
    swapped.set(ct.subarray(16, 16 + full), 16 + full);
    await expect(v.decryptFile(fk, FILE_ID, swapped)).rejects.toThrow();
    // Rewriting the header's chunk count is caught by the AAD.
    const recount = ct.slice();
    new DataView(recount.buffer).setUint32(12, 2);
    await expect(v.decryptFile(fk, FILE_ID, recount.subarray(0, 16 + 2 * full))).rejects.toThrow();
  });
});

describe('key wrapping', () => {
  it('wraps file keys under the vault key; a different vault key fails', async () => {
    const vk = v.generateVaultKey();
    const fk = await v.generateFileKey();
    const ct = await v.encryptFile(fk, FILE_ID, bytes(10));
    const wrapped = await v.wrapFileKey(vk, fk);
    expect(v.fromBase64(wrapped)).toHaveLength(40);
    const fk2 = await v.unwrapFileKey(vk, wrapped);
    expect(await v.decryptFile(fk2, FILE_ID, ct)).toEqual(bytes(10));
    await expect(v.unwrapFileKey(v.generateVaultKey(), wrapped)).rejects.toThrow(v.VaultCryptoError);
  });

  it('seals metadata bound to its label and object', async () => {
    const fk = await v.generateFileKey();
    const meta = { name: 'tax-return.pdf', type: 'application/pdf', size: 10, modified: 1 };
    const sealed = await v.sealJson(fk, 'meta', FILE_ID, meta);
    expect(sealed).not.toContain('tax');
    expect(await v.openJson(fk, 'meta', FILE_ID, sealed)).toEqual(meta);
    await expect(v.openJson(fk, 'meta', OTHER_ID, sealed)).rejects.toThrow();
    await expect(v.openJson(fk, 'name', FILE_ID, sealed)).rejects.toThrow();
  });

  it('derives a stable folder-name key per vault', async () => {
    const vk = v.generateVaultKey();
    const sealed = await v.sealJson(await v.deriveNameKey(vk, VAULT_ID), 'folder', OTHER_ID, 'Work');
    expect(await v.openJson(await v.deriveNameKey(vk, VAULT_ID), 'folder', OTHER_ID, sealed)).toBe('Work');
    await expect(v.openJson(await v.deriveNameKey(vk, OTHER_ID), 'folder', OTHER_ID, sealed)).rejects.toThrow();
  });
});

describe('device envelopes (JWE ECDH-ES+A256KW)', () => {
  it('only the intended device can unwrap the vault key', async () => {
    const vk = v.generateVaultKey();
    const alice = await v.generateDeviceKeyPair();
    const mallory = await v.generateDeviceKeyPair();
    const jwk = await v.exportPublicJwk(alice.publicKey);
    expect(v.isPublicDeviceJwk(jwk)).toBe(true);
    const env = await v.wrapVaultKeyForDevice(vk, jwk);
    expect(JSON.parse(atob(env.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ alg: 'ECDH-ES+A256KW', enc: 'A256GCM' });
    expect(await v.unwrapVaultKeyForDevice(env, alice.privateKey)).toEqual(vk);
    await expect(v.unwrapVaultKeyForDevice(env, mallory.privateKey)).rejects.toThrow(v.VaultCryptoError);
    const tampered = env.slice(0, -4) + (env.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(v.unwrapVaultKeyForDevice(tampered, alice.privateKey)).rejects.toThrow(v.VaultCryptoError);
  });

  it('device private keys are non-extractable', async () => {
    const kp = await v.generateDeviceKeyPair();
    expect(kp.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('jwk', kp.privateKey)).rejects.toThrow();
  });

  it('fingerprints are stable, formatted, and differ between keys', async () => {
    const a = await v.exportPublicJwk((await v.generateDeviceKeyPair()).publicKey);
    const b = await v.exportPublicJwk((await v.generateDeviceKeyPair()).publicKey);
    const fa = await v.deviceFingerprint(a);
    expect(fa).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(await v.deviceFingerprint({ ...a })).toBe(fa);
    expect(await v.deviceFingerprint(b)).not.toBe(fa);
  });

  it('rejects malformed device keys', () => {
    expect(v.isPublicDeviceJwk({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' })).toBe(false);
    expect(v.isPublicDeviceJwk({ kty: 'EC', crv: 'P-384', x: 'a'.repeat(43), y: 'b'.repeat(43) })).toBe(false);
    expect(v.isPublicDeviceJwk({ kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43), d: 'x' })).toBe(false);
  });
});

describe('recovery key', () => {
  it('unwraps the vault key and survives formatting differences', async () => {
    const vk = v.generateVaultKey();
    const rk = await v.generateRecoveryKey();
    expect(rk.display).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
    const env = await v.wrapVaultKeyForRecovery(vk, rk.bytes, VAULT_ID);
    const typed = rk.display.toLowerCase().replace(/-/g, ' ');
    expect(await v.unwrapVaultKeyForRecovery(env, await v.parseRecoveryKey(typed), VAULT_ID)).toEqual(vk);
  });

  it('catches typos with the checksum and rejects the wrong key or vault', async () => {
    const vk = v.generateVaultKey();
    const rk = await v.generateRecoveryKey();
    const env = await v.wrapVaultKeyForRecovery(vk, rk.bytes, VAULT_ID);
    const typo = (rk.display[0] === 'A' ? 'B' : 'A') + rk.display.slice(1);
    await expect(v.parseRecoveryKey(typo)).rejects.toThrow(/typo/);
    await expect(v.parseRecoveryKey('ABCD-EFGH')).rejects.toThrow();
    const other = await v.generateRecoveryKey();
    await expect(v.unwrapVaultKeyForRecovery(env, other.bytes, VAULT_ID)).rejects.toThrow(v.VaultCryptoError);
    await expect(v.unwrapVaultKeyForRecovery(env, rk.bytes, OTHER_ID)).rejects.toThrow(v.VaultCryptoError);
  });
});

describe('key rotation primitives', () => {
  it('re-wraps a file key to a new vault key without changing the file key', async () => {
    const vk1 = v.generateVaultKey();
    const vk2 = v.generateVaultKey();
    const fk = await v.generateFileKey();
    const fileId = crypto.randomUUID();
    const object = await v.encryptFile(fk, fileId, new TextEncoder().encode('rotate me'));
    const w1 = await v.wrapFileKey(vk1, fk);
    const w2 = await v.rewrapFileKey(vk1, vk2, w1);
    expect(w2).not.toBe(w1);
    // The same content decrypts with the re-wrapped key…
    expect(new TextDecoder().decode(await v.decryptFile(await v.unwrapFileKey(vk2, w2), fileId, object))).toBe('rotate me');
    // …and the old vault key can't unwrap the new wrapping.
    await expect(v.unwrapFileKey(vk1, w2)).rejects.toThrow(v.VaultCryptoError);
    await expect(v.rewrapFileKey(v.generateVaultKey(), vk2, w1)).rejects.toThrow(v.VaultCryptoError);
  });

  it('derives independent name and Space keys per vault key', async () => {
    const vk = v.generateVaultKey();
    const id = crypto.randomUUID();
    const space = await v.deriveSpaceKey(vk, VAULT_ID);
    const names = await v.deriveNameKey(vk, VAULT_ID);
    const sealed = await v.sealJson(space, 'space-item', id, { url: 'https://example.com' });
    await expect(v.openJson(names, 'space-item', id, sealed)).rejects.toThrow(v.VaultCryptoError);
    await expect(v.openJson(await v.deriveSpaceKey(v.generateVaultKey(), VAULT_ID), 'space-item', id, sealed)).rejects.toThrow(v.VaultCryptoError);
    expect(await v.openJson(space, 'space-item', id, sealed)).toEqual({ url: 'https://example.com' });
  });
});

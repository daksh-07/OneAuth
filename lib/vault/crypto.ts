/**
 * OneAuth Cloud client-side cryptography (design: docs/cloud/security-design.md).
 *
 * Standard primitives only, via WebCrypto (browser and Node) and `jose`:
 * AES-256-GCM, AES-KW (RFC 3394), HKDF-SHA256, ECDH P-256, JWE ECDH-ES+A256KW
 * (RFC 7518) and JWK thumbprints (RFC 7638). Nothing here talks to the network.
 */
import { calculateJwkThumbprint, CompactEncrypt, compactDecrypt, importJWK, type JWK } from 'jose';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const FORMAT_MAGIC = 'OAC1';
export const FORMAT_VERSION = 1;
export const CHUNK_SIZE = 1024 * 1024;
const HEADER_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

/** UUID string → 16 bytes (binds ciphertext to a specific object). */
export function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new VaultCryptoError('Invalid object identifier');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------- vault key

/** A fresh 256-bit vault key. It exists in plaintext only in client memory. */
export function generateVaultKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

function assertKey(raw: Uint8Array) {
  if (raw.length !== 32) throw new VaultCryptoError('Vault key must be 256 bits');
}

async function kwKey(raw: Uint8Array): Promise<CryptoKey> {
  assertKey(raw);
  return subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-KW', false, ['wrapKey', 'unwrapKey']);
}

async function hkdf(raw: Uint8Array, salt: Uint8Array, info: string, usage: 'AES-GCM' | 'AES-KW'): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, info: enc.encode(info) },
    base,
    { name: usage, length: 256 },
    false,
    usage === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['wrapKey', 'unwrapKey'],
  );
}

/** Key for encrypting Space items (bookmarks, shortcuts): HKDF(VK, salt = vaultId, info = "oneauth/v1/space"). */
export function deriveSpaceKey(vaultKey: Uint8Array, vaultId: string): Promise<CryptoKey> {
  assertKey(vaultKey);
  return hkdf(vaultKey, uuidBytes(vaultId), 'oneauth/v1/space', 'AES-GCM');
}

/** Key for encrypting folder names: HKDF(VK, salt = vaultId, info = "oneauth/v1/names"). */
export function deriveNameKey(vaultKey: Uint8Array, vaultId: string): Promise<CryptoKey> {
  assertKey(vaultKey);
  return hkdf(vaultKey, uuidBytes(vaultId), 'oneauth/v1/names', 'AES-GCM');
}

// ---------------------------------------------------------------- file keys

/** A fresh per-file-version AES-256-GCM key (extractable only so it can be wrapped). */
export function generateFileKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
}

/** AES-KW(VK, FK): 40 bytes, base64. */
export async function wrapFileKey(vaultKey: Uint8Array, fileKey: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await subtle.wrapKey('raw', fileKey, await kwKey(vaultKey), 'AES-KW')));
}

/**
 * Key rotation: re-wraps a file key from one vault key to another. The file key
 * is extractable only inside this function (AES-KW needs that to re-wrap it)
 * and is never returned. The result is checked to unwrap under the new key.
 */
export async function rewrapFileKey(oldVaultKey: Uint8Array, newVaultKey: Uint8Array, wrapped: string): Promise<string> {
  let fk: CryptoKey;
  try {
    fk = await subtle.unwrapKey('raw', fromBase64(wrapped), await kwKey(oldVaultKey), 'AES-KW', { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch {
    throw new VaultCryptoError('A file key couldn’t be unwrapped with the current vault key');
  }
  const next = toBase64(new Uint8Array(await subtle.wrapKey('raw', fk, await kwKey(newVaultKey), 'AES-KW')));
  await unwrapFileKey(newVaultKey, next); // throws if the new wrapping is unusable
  return next;
}

export async function unwrapFileKey(vaultKey: Uint8Array, wrapped: string): Promise<CryptoKey> {
  try {
    return await subtle.unwrapKey('raw', fromBase64(wrapped), await kwKey(vaultKey), 'AES-KW', { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  } catch {
    throw new VaultCryptoError('This file key can’t be unlocked with this vault key');
  }
}

// ---------------------------------------------------------------- file content

/** AAD for chunk i: purpose label, file ID, the complete 16-byte header (so every header bit is authenticated), and i. */
function chunkAad(fileId: Uint8Array, header: Uint8Array, index: number): Uint8Array<ArrayBuffer> {
  return concat(enc.encode('oneauth/v1/chunk'), fileId, header, u32(index));
}

/**
 * Encrypts a whole file into the OAC1 format (§4): header, then for each
 * 1 MiB chunk a random nonce and AES-256-GCM ciphertext whose AAD binds the
 * file ID, chunk index and chunk count.
 */
export async function encryptFile(
  fileKey: CryptoKey,
  fileId: string,
  plaintext: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const id = uuidBytes(fileId);
  const count = Math.max(1, Math.ceil(plaintext.length / CHUNK_SIZE));
  const header = concat(enc.encode(FORMAT_MAGIC), Uint8Array.of(FORMAT_VERSION, 0, 0, 0), u32(CHUNK_SIZE), u32(count));
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < count; i++) {
    const nonce = randomBytes(NONCE_LEN);
    const chunk = plaintext.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: chunkAad(id, header, i) }, fileKey, chunk as Uint8Array<ArrayBuffer>);
    parts.push(nonce, new Uint8Array(ct));
    onProgress?.(i + 1, count);
  }
  return concat(...parts);
}

/** Exact ciphertext size for a plaintext of `n` bytes (used for quota reservation). */
export function encryptedSize(n: number): number {
  const count = Math.max(1, Math.ceil(n / CHUNK_SIZE));
  return HEADER_LEN + count * (NONCE_LEN + TAG_LEN) + n;
}

/** Decrypts an OAC1 object. Any modification, reordering, truncation or extension throws. */
export async function decryptFile(
  fileKey: CryptoKey,
  fileId: string,
  object: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const fail = () => new VaultCryptoError('This file failed its integrity check and wasn’t decrypted');
  if (object.length < HEADER_LEN + NONCE_LEN + TAG_LEN) throw fail();
  if (dec.decode(object.subarray(0, 4)) !== FORMAT_MAGIC || object[4] !== FORMAT_VERSION) throw fail();
  if (object[5] !== 0 || object[6] !== 0 || object[7] !== 0) throw fail();
  const header = object.subarray(0, HEADER_LEN);
  const view = new DataView(object.buffer, object.byteOffset, object.byteLength);
  const chunkSize = view.getUint32(8);
  const count = view.getUint32(12);
  if (chunkSize !== CHUNK_SIZE || count < 1) throw fail();
  const id = uuidBytes(fileId);
  const out: Uint8Array[] = [];
  let o = HEADER_LEN;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const ctLen = last ? object.length - o - NONCE_LEN : chunkSize + TAG_LEN;
    if (ctLen < TAG_LEN || o + NONCE_LEN + ctLen > object.length) throw fail();
    if (!last && ctLen !== chunkSize + TAG_LEN) throw fail();
    if (last && ctLen > chunkSize + TAG_LEN) throw fail();
    const nonce = object.subarray(o, o + NONCE_LEN);
    const ct = object.subarray(o + NONCE_LEN, o + NONCE_LEN + ctLen);
    try {
      out.push(
        new Uint8Array(
          await subtle.decrypt(
            { name: 'AES-GCM', iv: nonce as Uint8Array<ArrayBuffer>, additionalData: chunkAad(id, header, i) },
            fileKey,
            ct as Uint8Array<ArrayBuffer>,
          ),
        ),
      );
    } catch {
      throw fail();
    }
    o += NONCE_LEN + ctLen;
    onProgress?.(i + 1, count);
  }
  if (o !== object.length) throw fail();
  return concat(...out);
}

// ---------------------------------------------------------------- small records (metadata, names)

/** AES-256-GCM of a JSON value, bound to a purpose label and an object ID. Output: base64(nonce ‖ ct). */
export async function sealJson(key: CryptoKey, label: string, objectId: string, value: unknown): Promise<string> {
  const nonce = randomBytes(NONCE_LEN);
  const aad = concat(enc.encode(`oneauth/v1/${label}`), uuidBytes(objectId));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, enc.encode(JSON.stringify(value)));
  return toBase64(concat(nonce, new Uint8Array(ct)));
}

export async function openJson<T>(key: CryptoKey, label: string, objectId: string, sealed: string): Promise<T> {
  const raw = fromBase64(sealed);
  const aad = concat(enc.encode(`oneauth/v1/${label}`), uuidBytes(objectId));
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, NONCE_LEN), additionalData: aad }, key, raw.subarray(NONCE_LEN));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new VaultCryptoError('This item couldn’t be decrypted');
  }
}

export interface FileMetadata {
  name: string;
  type: string;
  size: number;
  modified: number;
}

// ---------------------------------------------------------------- device keys and envelopes

/** ECDH P-256 key pair; the private key is non-extractable (it can be used, never exported). */
export function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export interface PublicDeviceJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export async function exportPublicJwk(publicKey: CryptoKey): Promise<PublicDeviceJwk> {
  const j = await subtle.exportKey('jwk', publicKey);
  if (j.kty !== 'EC' || j.crv !== 'P-256' || !j.x || !j.y) throw new VaultCryptoError('Unexpected device key');
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
}

export function isPublicDeviceJwk(v: unknown): v is PublicDeviceJwk {
  const j = v as Record<string, unknown>;
  return (
    !!j &&
    j.kty === 'EC' &&
    j.crv === 'P-256' &&
    typeof j.x === 'string' &&
    typeof j.y === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(j.x) &&
    /^[A-Za-z0-9_-]{43}$/.test(j.y) &&
    Object.keys(j).length === 4
  );
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new VaultCryptoError('Invalid character');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * Human-comparable device fingerprint: the RFC 7638 JWK thumbprint (SHA-256),
 * first 60 bits as Base32, formatted XXXX-XXXX-XXXX. Both devices compute it
 * independently from the public key, so a substituted key shows a different value.
 *
 * 60 bits: an attacker who substitutes keys has to grind about 2^60 key pairs
 * to match a code in the minutes before it's compared. The earlier 40-bit code
 * (about 2^40 key generations) was within reach of rented compute.
 */
export async function deviceFingerprint(jwk: PublicDeviceJwk): Promise<string> {
  const thumb = await calculateJwkThumbprint(jwk as JWK, 'sha256');
  const b32 = base32(Uint8Array.from(atob(thumb.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)).subarray(0, 8));
  return `${b32.slice(0, 4)}-${b32.slice(4, 8)}-${b32.slice(8, 12)}`;
}

/**
 * JWE (compact) ECDH-ES+A256KW / A256GCM of the vault key to a device's public key.
 * The protected header carries `oak_kv`, the vault-key version, which the AEAD
 * authenticates: the server can't relabel an old envelope as a newer version.
 * (Envelopes from before Phase 2C have no `oak_kv` and are treated as version 1.)
 */
export async function wrapVaultKeyForDevice(vaultKey: Uint8Array, device: PublicDeviceJwk, keyVersion = 1): Promise<string> {
  assertKey(vaultKey);
  if (!isPublicDeviceJwk(device)) throw new VaultCryptoError('Invalid device key');
  if (!Number.isInteger(keyVersion) || keyVersion < 1) throw new VaultCryptoError('Invalid key version');
  const key = await importJWK(device as JWK, 'ECDH-ES+A256KW');
  return new CompactEncrypt(vaultKey)
    .setProtectedHeader({ alg: 'ECDH-ES+A256KW', enc: 'A256GCM', kid: await calculateJwkThumbprint(device as JWK, 'sha256'), oak_kv: keyVersion })
    .encrypt(key);
}

/** Like unwrapVaultKeyForDevice, also returning the authenticated key version from the envelope. */
export async function openVaultEnvelope(envelope: string, privateKey: CryptoKey): Promise<{ vaultKey: Uint8Array; keyVersion: number }> {
  try {
    const { plaintext, protectedHeader } = await compactDecrypt(envelope, privateKey, {
      keyManagementAlgorithms: ['ECDH-ES+A256KW'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    assertKey(plaintext);
    const kv = protectedHeader.oak_kv === undefined ? 1 : protectedHeader.oak_kv;
    if (typeof kv !== 'number' || !Number.isInteger(kv) || kv < 1) throw new Error('kv');
    return { vaultKey: plaintext, keyVersion: kv };
  } catch {
    throw new VaultCryptoError('This device can’t unlock the vault');
  }
}

/** A one-way commitment to a vault key (for local pinning); reveals nothing usable about the key. */
export async function vaultKeyCommitment(vaultKey: Uint8Array, vaultId: string, keyVersion: number): Promise<string> {
  assertKey(vaultKey);
  return toBase64(await sha256(concat(enc.encode('oneauth/v1/vk-commit'), uuidBytes(vaultId), u32(keyVersion), vaultKey)));
}

/**
 * Post-approval confirmation code (Phase 2C, G5). Both the approving browser
 * (from the vault key it holds) and the new browser (from the vault key it
 * actually received) compute it. If a server injected a different vault key
 * into the new browser's envelope, the codes differ. 60 bits, XXXX-XXXX-XXXX.
 */
export async function vaultConfirmationCode(vaultKey: Uint8Array, vaultId: string, keyVersion: number, device: PublicDeviceJwk): Promise<string> {
  assertKey(vaultKey);
  const thumb = await calculateJwkThumbprint(device as JWK, 'sha256');
  const digest = await sha256(concat(enc.encode('oneauth/v1/vk-confirm'), uuidBytes(vaultId), u32(keyVersion), await sha256(vaultKey), enc.encode(thumb)));
  const b32 = base32(digest.subarray(0, 8));
  return `${b32.slice(0, 4)}-${b32.slice(4, 8)}-${b32.slice(8, 12)}`;
}

export async function unwrapVaultKeyForDevice(envelope: string, privateKey: CryptoKey): Promise<Uint8Array> {
  try {
    const { plaintext, protectedHeader } = await compactDecrypt(envelope, privateKey, {
      keyManagementAlgorithms: ['ECDH-ES+A256KW'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    if (protectedHeader.alg !== 'ECDH-ES+A256KW') throw new Error('alg');
    assertKey(plaintext);
    return plaintext;
  } catch {
    throw new VaultCryptoError('This device can’t unlock the vault');
  }
}

// ---------------------------------------------------------------- recovery key

/**
 * 256 random bits shown as 13 groups of 4 Base32 characters, plus one group
 * holding a 20-bit checksum so typing mistakes are caught before any decryption.
 */
export async function generateRecoveryKey(): Promise<{ bytes: Uint8Array; display: string }> {
  const bytes = randomBytes(32);
  return { bytes, display: await displayRecoveryKey(bytes) };
}

function recoveryChecksum(bytes: Uint8Array): Promise<string> {
  return sha256(concat(enc.encode('oneauth/v1/recovery-check'), bytes)).then((h) => base32(h).slice(0, 4));
}

function formatRecoveryKey(bytes: Uint8Array, check?: string): string {
  const body = base32(bytes); // 52 characters
  const groups = body.match(/.{4}/g)!;
  return [...groups, check ?? ''].filter(Boolean).join('-');
}

export async function displayRecoveryKey(bytes: Uint8Array): Promise<string> {
  return formatRecoveryKey(bytes, await recoveryChecksum(bytes));
}

/** Parses a typed recovery key; tolerant of spacing, case and separators; verifies the checksum. */
export async function parseRecoveryKey(input: string): Promise<Uint8Array> {
  const s = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (s.length !== 56) throw new VaultCryptoError('A recovery key has 14 groups of 4 characters');
  const bytes = unbase32(s.slice(0, 52)).subarray(0, 32);
  if ((await recoveryChecksum(bytes)) !== s.slice(52)) {
    throw new VaultCryptoError('That recovery key has a typo: please check each group');
  }
  return bytes;
}

/** AES-KW(HKDF(RK, salt = vaultId, info = "oneauth/v1/recovery"), VK), base64. */
export async function wrapVaultKeyForRecovery(vaultKey: Uint8Array, recoveryKey: Uint8Array, vaultId: string): Promise<string> {
  assertKey(vaultKey);
  const krk = await hkdf(recoveryKey, uuidBytes(vaultId), 'oneauth/v1/recovery', 'AES-KW');
  const vk = await subtle.importKey('raw', vaultKey as Uint8Array<ArrayBuffer>, 'AES-GCM', true, ['encrypt']);
  return toBase64(new Uint8Array(await subtle.wrapKey('raw', vk, krk, 'AES-KW')));
}

export async function unwrapVaultKeyForRecovery(envelope: string, recoveryKey: Uint8Array, vaultId: string): Promise<Uint8Array> {
  try {
    const krk = await hkdf(recoveryKey, uuidBytes(vaultId), 'oneauth/v1/recovery', 'AES-KW');
    const vk = await subtle.unwrapKey('raw', fromBase64(envelope), krk, 'AES-KW', { name: 'AES-GCM' }, true, ['encrypt']);
    return new Uint8Array(await subtle.exportKey('raw', vk));
  } catch {
    throw new VaultCryptoError('That recovery key doesn’t unlock this vault');
  }
}

/**
 * Proof that a client holds the recovery key, without revealing it or KRK:
 * HKDF-SHA256(RK, salt = vaultId, info = "oneauth/v1/recovery-proof"), 32 bytes, base64.
 * The server stores only SHA-256 of this value (set at vault creation) and
 * compares on recovery, so a device can't make itself active via "recovery"
 * without the key. Domain-separated from KRK by the HKDF info string.
 */
export async function recoveryProof(recoveryKey: Uint8Array, vaultId: string): Promise<string> {
  const base = await subtle.importKey('raw', recoveryKey as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: uuidBytes(vaultId) as Uint8Array<ArrayBuffer>, info: enc.encode('oneauth/v1/recovery-proof') },
    base,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

// ---------------------------------------------------------------- rotation transition proofs (Phase 2C)

/** HMAC key that authenticates "the vault key after version N is K" statements. Derived from vault key N. */
export async function transitionKey(vaultKey: Uint8Array, vaultId: string, extractable = false): Promise<CryptoKey> {
  assertKey(vaultKey);
  const base = await subtle.importKey('raw', vaultKey as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: uuidBytes(vaultId) as Uint8Array<ArrayBuffer>, info: enc.encode('oneauth/v1/transition') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    extractable,
    ['sign', 'verify'],
  );
}

function transitionMessage(vaultId: string, from: number, to: number, nextCommitment: string) {
  return concat(enc.encode('oneauth/v1/transition-proof'), uuidBytes(vaultId), u32(from), u32(to), fromBase64(nextCommitment));
}

/** Made by the rotating browser: proves the new key came from someone holding the outgoing one. */
export async function transitionProof(oldKey: Uint8Array, newKey: Uint8Array, vaultId: string, from: number): Promise<string> {
  const k = await transitionKey(oldKey, vaultId);
  const commit = await vaultKeyCommitment(newKey, vaultId, from + 1);
  return toBase64(new Uint8Array(await subtle.sign('HMAC', k, transitionMessage(vaultId, from, from + 1, commit))));
}

/** Checked by every other browser (with the outgoing key, or a stored transitionKey) before trusting the new key. */
export async function verifyTransition(key: CryptoKey, newKey: Uint8Array, vaultId: string, from: number, proof: string): Promise<boolean> {
  try {
    const commit = await vaultKeyCommitment(newKey, vaultId, from + 1);
    return await subtle.verify('HMAC', key, fromBase64(proof), transitionMessage(vaultId, from, from + 1, commit));
  } catch {
    return false;
  }
}

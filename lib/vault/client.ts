'use client';

import { ApiError, postJson } from '@/lib/client/api';
import * as v from './crypto';
import { clearDeviceKeys, loadDeviceKeys, pinStore, saveDeviceKeys } from './keystore';
import { checkUnlock, markConfirmed, trustOwnKey, verifyResume, type Trust } from './trust';
export { VaultTrustError } from './trust';
import { downloadType, safeName } from './names';

/**
 * The browser half of OneAuth Cloud: everything that touches plaintext or an
 * unwrapped key happens here. The server only ever receives ciphertext,
 * wrapped keys and public keys. See docs/cloud/security-design.md.
 */

export const PART_SIZE = 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface VaultDevice {
  id: string;
  status: 'pending' | 'active';
  fingerprint: string;
  public_jwk: v.PublicDeviceJwk;
  device_name: string;
  created_at: string;
  is_current: boolean;
}
export interface VaultState {
  vault: { id: string; key_version: number; created_at: string } | null;
  rotation: { id: string; to_version: number; reason: string; started_at: string } | null;
  transitions: { from_version: number; to_version: number; transition_proof: string | null }[];
  device: { id: string; status: 'pending' | 'active'; fingerprint: string; envelope: string | null } | null;
  devices: VaultDevice[];
  usage: { used: number; reserved: number; quota: number };
}
export interface FolderRow {
  id: string;
  parent_id: string | null;
  encrypted_name: string;
  updated_at: string;
  trashed_at: string | null;
}
export interface FileRow {
  id: string;
  folder_id: string | null;
  size_bytes: number;
  part_count: number;
  encrypted_meta: string;
  wrapped_key: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}
export interface FileMeta {
  name: string;
  type: string;
  size: number;
  modified?: number;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'You appear to be offline. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'error', data.message ?? 'Something went wrong. Please try again.', res.status);
  return data as T;
}

export const getState = () => request<VaultState>('GET', '/api/cloud/vault');

// ---------------------------------------------------------------- device key

/** This browser's key pair, created (non-extractable) on first use. */
export async function deviceKeys(userId: string): Promise<{ keys: CryptoKeyPair; jwk: v.PublicDeviceJwk }> {
  let keys = await loadDeviceKeys(userId);
  if (!keys) {
    keys = await v.generateDeviceKeyPair();
    await saveDeviceKeys(userId, keys);
  }
  return { keys, jwk: await v.exportPublicJwk(keys.publicKey) };
}

export function fingerprintOf(jwk: v.PublicDeviceJwk) {
  return v.deviceFingerprint(jwk);
}

// ---------------------------------------------------------------- vault lifecycle

export interface PreparedVault {
  vaultId: string;
  vaultKey: Uint8Array;
  recovery: { bytes: Uint8Array; display: string };
}

/** Generates a vault and recovery key locally. Nothing is sent until createVault. */
export async function prepareVault(): Promise<PreparedVault> {
  return { vaultId: crypto.randomUUID(), vaultKey: v.generateVaultKey(), recovery: await v.generateRecoveryKey() };
}

export async function createVault(p: PreparedVault, jwk: v.PublicDeviceJwk, userId: string) {
  const res = await postJson('/api/cloud/vault', {
    vaultId: p.vaultId,
    recoveryEnvelope: await v.wrapVaultKeyForRecovery(p.vaultKey, p.recovery.bytes, p.vaultId),
    recoveryProof: await v.recoveryProof(p.recovery.bytes, p.vaultId),
    publicJwk: jwk,
    envelope: await v.wrapVaultKeyForDevice(p.vaultKey, jwk, 1),
  });
  await trustOwnKey(pinStore(userId), p.vaultKey, p.vaultId, 1); // this browser made the key
  return res;
}

export function registerDevice(jwk: v.PublicDeviceJwk) {
  return postJson<{ id: string; status: 'pending' | 'active'; fingerprint: string }>('/api/cloud/vault/devices', { publicJwk: jwk });
}

/**
 * Opens this browser's envelope and checks it against what this browser has
 * seen before (lib/vault/trust.ts): refuses rollback and substitution, and
 * reports 'needs_confirmation' for a key it couldn't verify by itself.
 */
export async function unlock(state: VaultState, privateKey: CryptoKey, userId: string): Promise<{ vaultKey: Uint8Array; keyVersion: number; trust: Trust }> {
  if (!state.device?.envelope || !state.vault) throw new Error('This device has no vault access');
  return checkUnlock({
    envelope: state.device.envelope,
    privateKey,
    vaultId: state.vault.id,
    serverVersion: state.vault.key_version,
    transitions: state.transitions ?? [],
    store: pinStore(userId),
  });
}

/** The code both browsers show after an approval or key change; the user compares them (G5). */
export const confirmationCode = (vaultKey: Uint8Array, vaultId: string, keyVersion: number, jwk: v.PublicDeviceJwk) =>
  v.vaultConfirmationCode(vaultKey, vaultId, keyVersion, jwk);

export const confirmThisBrowser = (userId: string, keyVersion: number) => markConfirmed(pinStore(userId), keyVersion);

/**
 * Approves another browser. The fingerprint is recomputed here from the key
 * the server returned, so the user compares what this browser will actually
 * encrypt to, not what the server claims.
 */
export async function approveDevice(device: VaultDevice, vaultKey: Uint8Array, keyVersion: number) {
  const fingerprint = await v.deviceFingerprint(device.public_jwk);
  return postJson(`/api/cloud/vault/devices/${device.id}`, { envelope: await v.wrapVaultKeyForDevice(vaultKey, device.public_jwk, keyVersion), fingerprint, keyVersion });
}

/**
 * Removes this browser's own vault access and deletes its device key, e.g.
 * before handing the computer on. Signing in again later needs a new approval.
 */
export async function forgetThisBrowser(userId: string, vaultDeviceId: string) {
  await request('DELETE', `/api/cloud/vault/devices/${vaultDeviceId}`);
  await clearDeviceKeys(userId);
}

export function revokeVaultDevice(id: string) {
  return request('DELETE', `/api/cloud/vault/devices/${id}`);
}

/** Unlocks with the recovery key on this browser and gives this browser its own envelope. */
export async function recoverWithKey(typed: string, jwk: v.PublicDeviceJwk, userId: string, keyVersion: number): Promise<Uint8Array> {
  const rk = await v.parseRecoveryKey(typed);
  const env = await request<{ vault_id: string; recovery_envelope: string }>('GET', '/api/cloud/vault/recovery');
  // AES-KW under a key derived from the recovery key authenticates the vault key: the server can't forge it.
  const vaultKey = await v.unwrapVaultKeyForRecovery(env.recovery_envelope, rk, env.vault_id);
  await postJson('/api/cloud/vault/recovery', {
    envelope: await v.wrapVaultKeyForDevice(vaultKey, jwk, keyVersion),
    recoveryProof: await v.recoveryProof(rk, env.vault_id),
  });
  await trustOwnKey(pinStore(userId), vaultKey, env.vault_id, keyVersion);
  return vaultKey;
}

// ---------------------------------------------------------------- files

export function listItems(view: 'folder' | 'recent' | 'favorites' | 'trash' | 'all', folderId: string | null) {
  const q = new URLSearchParams({ view, ...(folderId ? { folder: folderId } : {}) });
  return request<{ folders: FolderRow[]; files: FileRow[]; path: FolderRow[] }>('GET', `/api/cloud/items?${q}`);
}

/** Decrypted metadata, with the name sanitised (decrypted values are still untrusted input). */
function cleanMeta(meta: FileMeta): FileMeta {
  return { ...meta, name: safeName(meta.name, 'Untitled file'), size: Number.isFinite(meta.size) ? meta.size : 0 };
}

export async function openMeta(vaultKey: Uint8Array, f: FileRow): Promise<FileMeta> {
  const fk = await v.unwrapFileKey(vaultKey, f.wrapped_key);
  return cleanMeta(await v.openJson<FileMeta>(fk, 'meta', f.id, f.encrypted_meta));
}

export async function folderName(nameKey: CryptoKey, f: FolderRow): Promise<string> {
  return safeName((await v.openJson<{ name: string }>(nameKey, 'folder', f.id, f.encrypted_name)).name, 'Untitled folder');
}

export const nameKeyFor = (vaultKey: Uint8Array, vaultId: string) => v.deriveNameKey(vaultKey, vaultId);

export type Progress = (fraction: number, phase: 'encrypting' | 'uploading' | 'downloading' | 'decrypting') => void;

/**
 * Encrypts in the browser, then uploads ciphertext in 1 MiB parts. If anything
 * fails, the unfinished upload is cancelled so its quota reservation is released.
 */
export async function uploadFile(vaultKey: Uint8Array, keyVersion: number, file: File, folderId: string | null, onProgress: Progress = () => {}) {
  if (file.size > MAX_FILE_BYTES) throw new ApiError('too_large', `${file.name} is larger than the 25 MB preview limit.`, 413);
  const fileId = crypto.randomUUID();
  const fk = await v.generateFileKey();
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const object = await v.encryptFile(fk, fileId, plaintext, (d, t) => onProgress(d / t, 'encrypting'));
  const meta: FileMeta = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, modified: file.lastModified };
  const { partCount } = await postJson<{ partCount: number }>('/api/cloud/files', {
    fileId,
    folderId,
    size: object.length,
    sha256: Array.from(await v.sha256(object), (b) => b.toString(16).padStart(2, '0')).join(''),
    encryptedMeta: await v.sealJson(fk, 'meta', fileId, meta),
    wrappedKey: await v.wrapFileKey(vaultKey, fk),
    keyVersion,
  });
  try {
    for (let i = 0; i < partCount; i++) {
      const part = object.subarray(i * PART_SIZE, (i + 1) * PART_SIZE);
      const res = await fetch(`/api/cloud/files/${fileId}/parts/${i}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: part as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(data.error ?? 'error', data.message ?? 'The upload was interrupted.', res.status);
      }
      onProgress((i + 1) / partCount, 'uploading');
    }
    await postJson(`/api/cloud/files/${fileId}/complete`);
  } catch (err) {
    await request('DELETE', `/api/cloud/files/${fileId}`).catch(() => {});
    throw err;
  }
  return fileId;
}

/** Downloads ciphertext parts and decrypts locally. Any tampering fails decryption. */
export async function downloadFile(vaultKey: Uint8Array, f: FileRow, onProgress: Progress = () => {}): Promise<{ blob: Blob; meta: FileMeta }> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < f.part_count; i++) {
    const res = await fetch(`/api/cloud/files/${f.id}/parts/${i}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? 'error', data.message ?? 'The download was interrupted.', res.status);
    }
    const p = new Uint8Array(await res.arrayBuffer());
    parts.push(p);
    total += p.length;
    onProgress((i + 1) / f.part_count, 'downloading');
  }
  const object = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    object.set(p, off);
    off += p.length;
  }
  const fk = await v.unwrapFileKey(vaultKey, f.wrapped_key);
  const meta = cleanMeta(await v.openJson<FileMeta>(fk, 'meta', f.id, f.encrypted_meta));
  const plaintext = await v.decryptFile(fk, f.id, object, (d, t) => onProgress(d / t, 'decrypting'));
  return { blob: new Blob([plaintext as Uint8Array<ArrayBuffer>], { type: downloadType(meta.type) }), meta };
}

export async function renameFile(vaultKey: Uint8Array, f: FileRow, meta: FileMeta, name: string) {
  const fk = await v.unwrapFileKey(vaultKey, f.wrapped_key);
  return request('PATCH', `/api/cloud/files/${f.id}`, { encryptedMeta: await v.sealJson(fk, 'meta', f.id, { ...meta, name }) });
}

export const updateFile = (id: string, patch: { favorite?: boolean; trashed?: boolean; folderId?: string | null }) =>
  request('PATCH', `/api/cloud/files/${id}`, patch);
export const deleteFile = (id: string) => request('DELETE', `/api/cloud/files/${id}`);

export async function createFolder(nameKey: CryptoKey, keyVersion: number, parentId: string | null, name: string) {
  const id = crypto.randomUUID();
  await postJson('/api/cloud/folders', { id, parentId, encryptedName: await v.sealJson(nameKey, 'folder', id, { name }), keyVersion });
  return id;
}
export async function renameFolder(nameKey: CryptoKey, keyVersion: number, id: string, name: string) {
  return request('PATCH', `/api/cloud/folders/${id}`, { encryptedName: await v.sealJson(nameKey, 'folder', id, { name }), keyVersion });
}
export const updateFolder = (id: string, patch: { trashed?: boolean; parentId?: string | null }) => request('PATCH', `/api/cloud/folders/${id}`, patch);
export const deleteFolder = (id: string) => request('DELETE', `/api/cloud/folders/${id}`);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = n / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x < 10 ? x.toFixed(1) : Math.round(x)} ${units[i]}`;
}

/**
 * Unlocks the vault on this browser if it's already an approved vault device.
 * Never registers or creates anything: returns null when Cloud isn't set up here.
 */
export async function tryUnlock(userId: string): Promise<{ vaultKey: Uint8Array; vaultId: string; keyVersion: number; trusted: boolean } | null> {
  try {
    const keys = await loadDeviceKeys(userId);
    if (!keys) return null;
    const s = await getState();
    if (!s.vault || s.device?.status !== 'active') return null;
    const u = await unlock(s, keys.privateKey, userId);
    return { vaultKey: u.vaultKey, vaultId: s.vault.id, keyVersion: u.keyVersion, trusted: u.trust === 'trusted' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- spaces

export interface Space {
  id: string;
  name: string;
  kind: 'personal' | 'work' | 'study' | 'other';
  accent: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
  all_devices: boolean;
  device_ids: string[];
  prefs: { cloudSort?: 'name' | 'updated' | 'size'; linksInNewTab?: boolean };
}
export const listSpaces = () =>
  request<{ spaces: Space[]; selectedId: string | null; devices: { id: string; name: string }[] }>('GET', '/api/space');
export const selectSpace = (spaceId: string) => request('POST', '/api/space/select', { spaceId });
export const createSpace = (name: string, kind: Space['kind']) => request<{ id: string }>('POST', '/api/space', { name, kind });
export const updateSpace = (id: string, patch: Record<string, unknown>) => request('PATCH', `/api/space/${id}`, patch);
export const deleteSpace = (id: string) => request('DELETE', `/api/space/${id}`);
export const listPins = (id: string) =>
  request<{ files: (FileRow & { pin_id: string })[]; folders: (FolderRow & { pin_id: string })[]; locked: boolean; lockedCount: number }>('GET', `/api/space/${id}/pins`);
export const pinToSpace = (spaceId: string, item: { fileId?: string; folderId?: string }) => request('POST', `/api/space/${spaceId}/pins`, item);
export const unpinFromSpace = (spaceId: string, pinId: string) => request('DELETE', `/api/space/${spaceId}/pins/${pinId}`);

// ---------------------------------------------------------------- vault-key rotation (docs/cloud/key-rotation.md)

export { prepareRotation, type PreparedRotation } from './rotate';

type RotationProgress = (p: { done: number; total: number }) => void;

/**
 * Starts a rotation: the new key goes to every active browser with a transition
 * proof made with the current key. The recovery key is replaced unless the user
 * re-entered it (`keepRecoveryKey`, typed form), in which case it stays valid.
 */
export async function startRotation(
  prepared: import('./rotate').PreparedRotation,
  state: VaultState,
  reason: 'device_removed' | 'manual',
  currentKey: Uint8Array,
  keepRecoveryKey?: string,
) {
  const { startPayload } = await import('./rotate');
  const active = state.devices.filter((d) => d.status === 'active');
  const body = await startPayload(prepared, state.vault!.id, active, {
    oldKey: currentKey,
    fromVersion: state.vault!.key_version,
    keepRecoveryKey: keepRecoveryKey ? await v.parseRecoveryKey(keepRecoveryKey) : undefined,
  });
  return postJson<{ rotationId: string; toVersion: number }>('/api/cloud/vault/rotation', { reason, keyVersion: state.vault!.key_version, ...body });
}

/** After this browser committed a rotation it made or verified: it trusts the new key without a code. */
export const trustRotatedKey = (userId: string, newKey: Uint8Array, vaultId: string, keyVersion: number) =>
  trustOwnKey(pinStore(userId), newKey, vaultId, keyVersion);

/** Re-wraps everything still outstanding, then commits. Safe to call again after an interruption. */
export async function finishRotation(oldKey: Uint8Array, newKey: Uint8Array, vaultId: string, rotationId: string, onProgress: RotationProgress = () => {}) {
  const { rewrapBatch } = await import('./rotate');
  let done = 0;
  for (let round = 0; round < 10_000; round++) {
    const work = await request<import('./rotate').RotationWork & { rotationId: string; remaining: Record<string, number> }>('GET', '/api/cloud/vault/rotation/work');
    const left = work.remaining.files + work.remaining.folders + work.remaining.items;
    onProgress({ done, total: done + left });
    if (!work.files.length && !work.folders.length && !work.items.length) break;
    const batch = await rewrapBatch(work, oldKey, newKey, vaultId);
    await postJson('/api/cloud/vault/rotation/batch', { rotationId, ...batch });
    done += batch.files.length + batch.folders.length + batch.items.length;
  }
  await postJson('/api/cloud/vault/rotation/commit', { rotationId });
}

/**
 * For resuming: this browser's copy of the new key, wrapped to its own device
 * key at the start, accepted only if its transition proof verifies with the
 * current key. Without that check a server could plant a "rotation" and have
 * this browser re-wrap every file key under a key the server chose.
 */
export async function rotationNextKey(privateKey: CryptoKey, currentKey: Uint8Array, vaultId: string) {
  const s = await request<{ rotation: { id: string; from_version: number; to_version: number; transition_proof: string | null; nextEnvelope: string | null } | null }>(
    'GET',
    '/api/cloud/vault/rotation',
  );
  if (!s.rotation?.nextEnvelope) return null;
  const { vaultKey: newKey, keyVersion } = await v.openVaultEnvelope(s.rotation.nextEnvelope, privateKey);
  const ok = keyVersion === s.rotation.to_version && (await verifyResume(currentKey, newKey, vaultId, s.rotation.from_version, s.rotation.transition_proof));
  if (!ok) throw new v.VaultCryptoError('This key replacement can’t be verified, so this browser won’t continue it. Cancel it instead.');
  return { rotationId: s.rotation.id, newKey, toVersion: s.rotation.to_version };
}

export const abortRotation = (rotationId: string) => request('DELETE', '/api/cloud/vault/rotation', { rotationId });

// ---------------------------------------------------------------- encrypted Space items

export interface BookmarkBody {
  title: string;
  url: string;
  note?: string;
}
export interface ShortcutBody {
  label: string;
  url: string;
}
export interface SpaceItemRow {
  id: string;
  kind: 'bookmark' | 'shortcut';
  encrypted_body: string;
  position: number;
  version: number;
  updated_at: string;
}

export const spaceKeyFor = (vaultKey: Uint8Array, vaultId: string) => v.deriveSpaceKey(vaultKey, vaultId);

export const listSpaceItems = (spaceId: string) =>
  request<{ items: SpaceItemRow[]; locked: boolean; lockedCount: number }>('GET', `/api/space/${spaceId}/items`);

export async function openSpaceItem<T extends BookmarkBody | ShortcutBody>(spaceKey: CryptoKey, row: SpaceItemRow): Promise<T> {
  return v.openJson<T>(spaceKey, 'space-item', row.id, row.encrypted_body);
}

export async function createSpaceItem(spaceKey: CryptoKey, keyVersion: number, spaceId: string, kind: 'bookmark' | 'shortcut', body: BookmarkBody | ShortcutBody) {
  const id = crypto.randomUUID();
  return request('POST', `/api/space/${spaceId}/items`, { id, kind, keyVersion, encryptedBody: await v.sealJson(spaceKey, 'space-item', id, body) });
}

export async function updateSpaceItem(spaceKey: CryptoKey, keyVersion: number, spaceId: string, row: SpaceItemRow, body: BookmarkBody | ShortcutBody) {
  return request('PATCH', `/api/space/${spaceId}/items/${row.id}`, {
    version: row.version,
    keyVersion,
    encryptedBody: await v.sealJson(spaceKey, 'space-item', row.id, body),
  });
}

export const deleteSpaceItem = (spaceId: string, itemId: string) => request('DELETE', `/api/space/${spaceId}/items/${itemId}`);

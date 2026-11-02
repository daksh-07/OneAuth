'use client';

import { ApiError, postJson } from '@/lib/client/api';
import * as v from './crypto';
import { clearDeviceKeys, loadDeviceKeys, saveDeviceKeys } from './keystore';
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

export async function createVault(p: PreparedVault, jwk: v.PublicDeviceJwk) {
  return postJson('/api/cloud/vault', {
    vaultId: p.vaultId,
    recoveryEnvelope: await v.wrapVaultKeyForRecovery(p.vaultKey, p.recovery.bytes, p.vaultId),
    recoveryProof: await v.recoveryProof(p.recovery.bytes, p.vaultId),
    publicJwk: jwk,
    envelope: await v.wrapVaultKeyForDevice(p.vaultKey, jwk),
  });
}

export function registerDevice(jwk: v.PublicDeviceJwk) {
  return postJson<{ id: string; status: 'pending' | 'active'; fingerprint: string }>('/api/cloud/vault/devices', { publicJwk: jwk });
}

export function unlock(state: VaultState, privateKey: CryptoKey): Promise<Uint8Array> {
  if (!state.device?.envelope) throw new Error('This device has no vault access');
  return v.unwrapVaultKeyForDevice(state.device.envelope, privateKey);
}

/**
 * Approves another browser. The fingerprint is recomputed here from the key
 * the server returned, so the user compares what this browser will actually
 * encrypt to, not what the server claims.
 */
export async function approveDevice(device: VaultDevice, vaultKey: Uint8Array) {
  const fingerprint = await v.deviceFingerprint(device.public_jwk);
  return postJson(`/api/cloud/vault/devices/${device.id}`, { envelope: await v.wrapVaultKeyForDevice(vaultKey, device.public_jwk), fingerprint });
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
export async function recoverWithKey(typed: string, jwk: v.PublicDeviceJwk): Promise<Uint8Array> {
  const rk = await v.parseRecoveryKey(typed);
  const env = await request<{ vault_id: string; recovery_envelope: string }>('GET', '/api/cloud/vault/recovery');
  const vaultKey = await v.unwrapVaultKeyForRecovery(env.recovery_envelope, rk, env.vault_id);
  await postJson('/api/cloud/vault/recovery', {
    envelope: await v.wrapVaultKeyForDevice(vaultKey, jwk),
    recoveryProof: await v.recoveryProof(rk, env.vault_id),
  });
  return vaultKey;
}

// ---------------------------------------------------------------- files

export function listItems(view: 'folder' | 'recent' | 'favorites' | 'trash', folderId: string | null) {
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
export async function uploadFile(vaultKey: Uint8Array, file: File, folderId: string | null, onProgress: Progress = () => {}) {
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

export async function createFolder(nameKey: CryptoKey, parentId: string | null, name: string) {
  const id = crypto.randomUUID();
  await postJson('/api/cloud/folders', { id, parentId, encryptedName: await v.sealJson(nameKey, 'folder', id, { name }) });
  return id;
}
export async function renameFolder(nameKey: CryptoKey, id: string, name: string) {
  return request('PATCH', `/api/cloud/folders/${id}`, { encryptedName: await v.sealJson(nameKey, 'folder', id, { name }) });
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
export async function tryUnlock(userId: string): Promise<{ vaultKey: Uint8Array; vaultId: string } | null> {
  try {
    const keys = await loadDeviceKeys(userId);
    if (!keys) return null;
    const s = await getState();
    if (!s.vault || s.device?.status !== 'active') return null;
    return { vaultKey: await unlock(s, keys.privateKey), vaultId: s.vault.id };
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
}
export const listSpaces = () =>
  request<{ spaces: Space[]; selectedId: string | null; devices: { id: string; name: string }[] }>('GET', '/api/space');
export const selectSpace = (spaceId: string) => request('POST', '/api/space/select', { spaceId });
export const createSpace = (name: string, kind: Space['kind']) => request<{ id: string }>('POST', '/api/space', { name, kind });
export const updateSpace = (id: string, patch: Record<string, unknown>) => request('PATCH', `/api/space/${id}`, patch);
export const deleteSpace = (id: string) => request('DELETE', `/api/space/${id}`);
export const listPins = (id: string) =>
  request<{ files: (FileRow & { pin_id: string })[]; folders: (FolderRow & { pin_id: string })[] }>('GET', `/api/space/${id}/pins`);
export const pinToSpace = (spaceId: string, item: { fileId?: string; folderId?: string }) => request('POST', `/api/space/${spaceId}/pins`, item);
export const unpinFromSpace = (spaceId: string, pinId: string) => request('DELETE', `/api/space/${spaceId}/pins/${pinId}`);

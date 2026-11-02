import * as v from './crypto';

/**
 * The client half of vault-key rotation (docs/cloud/key-rotation.md §3), with
 * no network code, so the browser and the tests run the same re-wrapping.
 * Everything is decrypted with the old vault key and re-encrypted with the new
 * one; each result is checked to open under the new key before it's returned.
 */

export interface RotationWork {
  files: { id: string; wrapped_key: string }[];
  folders: { id: string; encrypted_name: string }[];
  items: { id: string; encrypted_body: string }[];
}

export interface RotationBatch {
  files: { id: string; wrappedKey: string }[];
  folders: { id: string; encryptedName: string }[];
  items: { id: string; encryptedBody: string }[];
}

export async function rewrapBatch(work: RotationWork, oldKey: Uint8Array, newKey: Uint8Array, vaultId: string): Promise<RotationBatch> {
  const [oldNames, newNames, oldSpace, newSpace] = await Promise.all([
    v.deriveNameKey(oldKey, vaultId),
    v.deriveNameKey(newKey, vaultId),
    v.deriveSpaceKey(oldKey, vaultId),
    v.deriveSpaceKey(newKey, vaultId),
  ]);
  const files = await Promise.all(work.files.map(async (f) => ({ id: f.id, wrappedKey: await v.rewrapFileKey(oldKey, newKey, f.wrapped_key) })));
  const folders = await Promise.all(
    work.folders.map(async (f) => {
      const value = await v.openJson(oldNames, 'folder', f.id, f.encrypted_name);
      const encryptedName = await v.sealJson(newNames, 'folder', f.id, value);
      await v.openJson(newNames, 'folder', f.id, encryptedName);
      return { id: f.id, encryptedName };
    }),
  );
  const items = await Promise.all(
    work.items.map(async (it) => {
      const value = await v.openJson(oldSpace, 'space-item', it.id, it.encrypted_body);
      const encryptedBody = await v.sealJson(newSpace, 'space-item', it.id, value);
      await v.openJson(newSpace, 'space-item', it.id, encryptedBody);
      return { id: it.id, encryptedBody };
    }),
  );
  return { files, folders, items };
}

export interface PreparedRotation {
  vaultKey: Uint8Array;
  recovery: { bytes: Uint8Array; display: string };
}

/** New vault key and recovery key, generated locally. Nothing is sent until the user has saved the recovery key. */
export async function prepareRotation(): Promise<PreparedRotation> {
  return { vaultKey: v.generateVaultKey(), recovery: await v.generateRecoveryKey() };
}

/** The start request: the new key wrapped to every active browser, and the new recovery material. */
export async function startPayload(p: PreparedRotation, vaultId: string, active: { id: string; public_jwk: v.PublicDeviceJwk }[]) {
  return {
    envelopes: await Promise.all(active.map(async (d) => ({ vaultDeviceId: d.id, envelope: await v.wrapVaultKeyForDevice(p.vaultKey, d.public_jwk) }))),
    recoveryEnvelope: await v.wrapVaultKeyForRecovery(p.vaultKey, p.recovery.bytes, vaultId),
    recoveryProof: await v.recoveryProof(p.recovery.bytes, vaultId),
  };
}

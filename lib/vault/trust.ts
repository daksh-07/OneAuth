import * as v from './crypto';

/**
 * Client-side trust in the vault key (Phase 2C; docs/cloud/key-rotation.md §3a).
 * Defends against a server that serves an old envelope (rollback), a different
 * key under the same version (substitution), or a key of its own as a new
 * version (injection). The server is untrusted here; everything is checked
 * against values this browser recorded itself.
 *
 * No browser APIs: the browser passes an IndexedDB-backed store, and tests an
 * in-memory one.
 */

export interface Pins {
  /** Highest vault-key version this browser has accepted. */
  maxVersion: number;
  /** Version → commitment to the vault key accepted for it. */
  commits: Record<number, string>;
  /** Versions whose key the user confirmed (or this browser created or derived itself). */
  confirmed: Record<number, true>;
  /** Version → non-extractable HMAC key for checking the transition *from* that version. */
  transitionKeys: Record<number, CryptoKey>;
}

export interface PinStore {
  get(): Promise<Pins | undefined>;
  set(pins: Pins): Promise<void>;
}

export type TrustErrorCode = 'rollback' | 'substituted' | 'version_mismatch';

export class VaultTrustError extends v.VaultCryptoError {
  constructor(public code: TrustErrorCode, message: string) {
    super(message);
  }
}

export interface Transition {
  from_version: number;
  to_version: number;
  transition_proof: string | null;
}

export type Trust = 'trusted' | 'needs_confirmation';

const empty = (): Pins => ({ maxVersion: 0, commits: {}, confirmed: {}, transitionKeys: {} });

async function record(store: PinStore, pins: Pins, vaultKey: Uint8Array, vaultId: string, keyVersion: number, confirmed: boolean) {
  pins.commits[keyVersion] = await v.vaultKeyCommitment(vaultKey, vaultId, keyVersion);
  pins.maxVersion = Math.max(pins.maxVersion, keyVersion);
  pins.transitionKeys[keyVersion] = await v.transitionKey(vaultKey, vaultId); // non-extractable
  if (confirmed) pins.confirmed[keyVersion] = true;
  await store.set(pins);
}

/**
 * Opens this browser's envelope and decides whether to trust the key in it.
 * Throws on rollback or substitution (never use such a key). Returns
 * 'needs_confirmation' when the key is new to this browser and couldn't be
 * verified cryptographically: the user must compare a confirmation code with
 * a browser that already has the key before this one writes under it.
 */
export async function checkUnlock(opts: {
  envelope: string;
  privateKey: CryptoKey;
  vaultId: string;
  serverVersion: number;
  transitions: Transition[];
  store: PinStore;
}): Promise<{ vaultKey: Uint8Array; keyVersion: number; trust: Trust }> {
  const { vaultKey, keyVersion } = await v.openVaultEnvelope(opts.envelope, opts.privateKey);
  if (keyVersion !== opts.serverVersion) {
    throw new VaultTrustError('version_mismatch', 'The vault key this browser received doesn’t match the vault’s current version.');
  }
  const pins = (await opts.store.get()) ?? empty();
  if (keyVersion < pins.maxVersion) {
    throw new VaultTrustError('rollback', 'This browser was sent an older vault key than one it has already used. It won’t use it.');
  }
  const commit = await v.vaultKeyCommitment(vaultKey, opts.vaultId, keyVersion);
  const known = pins.commits[keyVersion];
  if (known && known !== commit) {
    throw new VaultTrustError('substituted', 'This browser was sent a different vault key for a version it already knows. It won’t use it.');
  }
  if (known) return { vaultKey, keyVersion, trust: pins.confirmed[keyVersion] ? 'trusted' : 'needs_confirmation' };

  // A version this browser hasn't seen. Trust it automatically only if it's the
  // next one and the transition proof verifies with the key stored for the previous one.
  const prevKey = pins.transitionKeys[keyVersion - 1];
  const step = opts.transitions.find((t) => t.from_version === keyVersion - 1 && t.to_version === keyVersion);
  const proven = Boolean(prevKey && step?.transition_proof && (await v.verifyTransition(prevKey, vaultKey, opts.vaultId, keyVersion - 1, step.transition_proof)));
  await record(opts.store, pins, vaultKey, opts.vaultId, keyVersion, proven);
  return { vaultKey, keyVersion, trust: proven ? 'trusted' : 'needs_confirmation' };
}

/** For keys this browser made or derived through an authenticated path (vault creation, recovery key, its own rotation). */
export async function trustOwnKey(store: PinStore, vaultKey: Uint8Array, vaultId: string, keyVersion: number) {
  const pins = (await store.get()) ?? empty();
  const commit = await v.vaultKeyCommitment(vaultKey, vaultId, keyVersion);
  if (pins.commits[keyVersion] && pins.commits[keyVersion] !== commit) {
    throw new VaultTrustError('substituted', 'This browser already holds a different vault key for this version.');
  }
  await record(store, pins, vaultKey, vaultId, keyVersion, true);
}

/** The user compared confirmation codes and they matched. */
export async function markConfirmed(store: PinStore, keyVersion: number) {
  const pins = (await store.get()) ?? empty();
  if (!pins.commits[keyVersion]) throw new v.VaultCryptoError('Nothing to confirm for this version');
  pins.confirmed[keyVersion] = true;
  await store.set(pins);
}

/**
 * Before finishing someone else's interrupted rotation: the new key in this
 * browser's pending envelope must carry a transition proof made with the
 * current key. Otherwise a server could plant a "rotation" and have this
 * browser re-wrap every file key under a key the server chose.
 */
export async function verifyResume(currentKey: Uint8Array, nextKey: Uint8Array, vaultId: string, fromVersion: number, proof: string | null): Promise<boolean> {
  if (!proof) return false;
  return v.verifyTransition(await v.transitionKey(currentKey, vaultId), nextKey, vaultId, fromVersion, proof);
}

export function memoryPinStore(): PinStore {
  let pins: Pins | undefined;
  return { get: async () => pins, set: async (p) => void (pins = p) };
}

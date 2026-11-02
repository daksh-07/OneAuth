import 'server-only';
import { one } from '../db';
import { UserFacingError } from '../errors';
import { hasScope } from '../../scopes';
import type { SessionRecord } from '../sessions';

/**
 * OneAuth Cloud is a developer preview: on only where ONEAUTH_CLOUD_PREVIEW=1,
 * and never on a Vercel production deployment until the security design is reviewed.
 */
export function cloudEnabled(): boolean {
  return process.env.ONEAUTH_CLOUD_PREVIEW === '1' && process.env.VERCEL_ENV !== 'production';
}

/** Cloud is for passkey sessions on owned devices with the matching scope. */
export function assertCloudSession(session: SessionRecord, mode: 'read' | 'write') {
  if (!cloudEnabled()) throw new UserFacingError('cloud_unavailable', 'OneAuth Cloud isn’t available on this deployment.', 404);
  if (session.kind !== 'primary' || session.device_kind !== 'owned' || !hasScope(session.scopes, mode === 'read' ? 'cloud:read' : 'cloud:write')) {
    throw new UserFacingError('forbidden', 'Encrypted files are only available on your own devices, signed in with your passkey.', 403);
  }
}

export interface VaultDeviceRow {
  id: string;
  vault_id: string;
  status: 'pending' | 'active' | 'revoked';
  fingerprint: string;
  envelope: string | null;
}

/** Must run inside the user's tenant scope. Returns this browser's live vault-device record, if any. */
export function vaultDeviceFor(session: SessionRecord) {
  return one<VaultDeviceRow>(
    `select id, vault_id, status, fingerprint, envelope from vault_devices where device_id = $1 and status <> 'revoked'`,
    [session.device_id],
  );
}

/** Must run inside the user's tenant scope. Content and keys are only for active vault devices. */
export async function requireActiveVaultDevice(session: SessionRecord): Promise<VaultDeviceRow> {
  const dev = await vaultDeviceFor(session);
  if (!dev || dev.status !== 'active') {
    throw new UserFacingError('vault_locked', 'This device hasn’t been approved for your encrypted files yet.', 403);
  }
  return dev;
}

/**
 * Guard for every write that carries material protected by the vault key
 * (wrapped file keys, folder names, Space items, envelopes). Refuses while a
 * key rotation is in progress, and refuses a client whose `keyVersion` isn't
 * current (it would write under a retired key). FOR SHARE on the vault row
 * serialises with rotation start/commit (FOR UPDATE), so a write can't slip in
 * between commit's completeness check and its swap. Must run in the tenant scope.
 * See docs/cloud/key-rotation.md §4.
 */
export async function assertVaultKeyWritable(keyVersion: unknown, opts: { requireVersion?: boolean } = { requireVersion: true }) {
  const v = await one<{ id: string; key_version: number }>(`select id, key_version from vaults for share`);
  if (!v) throw new UserFacingError('no_vault', 'Set up your encrypted vault first.', 409);
  const rotating = await one(`select 1 from vault_rotations where vault_id = $1 and status = 'in_progress'`, [v.id]);
  if (rotating) {
    throw new UserFacingError('rotation_in_progress', 'Your vault key is being replaced. Try again when that’s finished.', 409);
  }
  if (opts.requireVersion !== false && Number(keyVersion) !== v.key_version) {
    throw new UserFacingError('stale_key', 'This browser is using an old vault key. Reload the page to continue.', 409);
  }
  return v;
}

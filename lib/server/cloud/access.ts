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

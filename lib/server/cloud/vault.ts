import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { asUser, one, query } from '../db';
import { UserFacingError } from '../errors';
import { recordEvent, type RequestContext } from '../events';
import { requireFreshReauth } from '../webauthn';
import type { SessionRecord } from '../sessions';
import { deviceFingerprint, isPublicDeviceJwk, type PublicDeviceJwk } from '../../vault/crypto';
import { assertCloudSession, requireActiveVaultDevice, vaultDeviceFor } from './access';
import { usageFor } from './quota';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64_KW = /^[A-Za-z0-9+/]{54}==$/; // 40-byte AES-KW output
const B64_32 = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes

function proofDigest(proof: unknown): Buffer {
  if (typeof proof !== 'string' || !B64_32.test(proof)) throw new UserFacingError('invalid', 'Invalid recovery proof.');
  return createHash('sha256').update(Buffer.from(proof, 'base64')).digest();
}

/** A compact JWE whose protected header declares the one algorithm pair we accept. */
function assertEnvelope(envelope: unknown): asserts envelope is string {
  if (typeof envelope !== 'string' || envelope.length > 2000) throw new UserFacingError('invalid', 'Invalid key envelope.');
  const parts = envelope.split('.');
  // ECDH-ES+A256KW: header . wrapped CEK . IV . ciphertext . tag, all non-empty base64url.
  if (parts.length !== 5 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) {
    throw new UserFacingError('invalid', 'Invalid key envelope.');
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'ECDH-ES+A256KW' || header.enc !== 'A256GCM') throw new Error('alg');
  } catch {
    throw new UserFacingError('invalid', 'Invalid key envelope.');
  }
}

function assertJwk(jwk: unknown): asserts jwk is PublicDeviceJwk {
  if (!isPublicDeviceJwk(jwk)) throw new UserFacingError('invalid', 'Invalid device key.');
}

export async function getVaultState(session: SessionRecord) {
  assertCloudSession(session, 'read');
  return asUser(session.user_id, async () => {
    const vault = await one<{ id: string; key_version: number; created_at: Date }>(`select id, key_version, created_at from vaults where user_id = $1`, [
      session.user_id,
    ]);
    const device = await vaultDeviceFor(session);
    const others = vault
      ? await query<{ id: string; status: string; fingerprint: string; public_jwk: PublicDeviceJwk; device_name: string; created_at: Date; is_current: boolean }>(
          `select vd.id, vd.status, vd.fingerprint, vd.public_jwk, d.name as device_name, vd.created_at, vd.device_id = $2 as is_current
             from vault_devices vd join devices d on d.id = vd.device_id
            where vd.user_id = $1 and vd.status <> 'revoked' and d.revoked_at is null
            order by vd.created_at`,
          [session.user_id, session.device_id],
        )
      : [];
    return {
      vault,
      device: device ? { id: device.id, status: device.status, fingerprint: device.fingerprint, envelope: device.status === 'active' ? device.envelope : null } : null,
      // Only an active device may see pending requests (it's the one that can approve them).
      devices: device?.status === 'active' ? others : others.filter((o) => o.is_current),
      usage: await usageFor(session.user_id),
    };
  });
}

export async function createVault(
  session: SessionRecord,
  input: { vaultId: unknown; recoveryEnvelope: unknown; recoveryProof: unknown; publicJwk: unknown; envelope: unknown },
  ctx: RequestContext,
) {
  assertCloudSession(session, 'write');
  requireFreshReauth(session);
  if (typeof input.vaultId !== 'string' || !UUID.test(input.vaultId)) throw new UserFacingError('invalid', 'Invalid vault.');
  if (typeof input.recoveryEnvelope !== 'string' || !B64_KW.test(input.recoveryEnvelope)) throw new UserFacingError('invalid', 'Invalid recovery envelope.');
  const verifier = proofDigest(input.recoveryProof);
  assertJwk(input.publicJwk);
  assertEnvelope(input.envelope);
  const fingerprint = await deviceFingerprint(input.publicJwk);
  const { vaultId, recoveryEnvelope, publicJwk, envelope } = input as { vaultId: string; recoveryEnvelope: string; publicJwk: PublicDeviceJwk; envelope: string };
  return asUser(session.user_id, async () => {
    const created = await one<{ id: string }>(
      `insert into vaults (id, user_id, recovery_envelope, recovery_verifier) values ($1, $2, $3, $4) on conflict (user_id) do nothing returning id`,
      [vaultId, session.user_id, recoveryEnvelope, verifier],
    );
    if (!created) throw new UserFacingError('vault_exists', 'You already have an encrypted vault.', 409);
    await query(`update vault_devices set status = 'revoked', envelope = null, revoked_at = now() where device_id = $1 and status <> 'revoked'`, [session.device_id]);
    await query(
      `insert into vault_devices (user_id, vault_id, device_id, public_jwk, fingerprint, status, envelope, approved_via, approved_at)
       values ($1, $2, $3, $4, $5, 'active', $6, 'creator', now())`,
      [session.user_id, vaultId, session.device_id, publicJwk, fingerprint, envelope],
    );
    await recordEvent({ type: 'cloud.vault_created', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    return { vaultId, fingerprint };
  });
}

/** Registers (or re-registers) this browser's device key; it starts pending until approved. */
export async function registerVaultDevice(session: SessionRecord, input: { publicJwk: unknown }, ctx: RequestContext) {
  assertCloudSession(session, 'read');
  assertJwk(input.publicJwk);
  const jwk = input.publicJwk;
  const fingerprint = await deviceFingerprint(jwk);
  return asUser(session.user_id, async () => {
    const vault = await one<{ id: string }>(`select id from vaults where user_id = $1`, [session.user_id]);
    if (!vault) throw new UserFacingError('no_vault', 'Set up your encrypted vault first.', 409);
    const existing = await vaultDeviceFor(session);
    if (existing && existing.fingerprint === fingerprint) return { id: existing.id, status: existing.status, fingerprint };
    if (existing) {
      // A different key for this browser (e.g. site data was cleared): start again as pending.
      await query(`update vault_devices set status = 'revoked', envelope = null, revoked_at = now() where id = $1`, [existing.id]);
    }
    const row = await one<{ id: string }>(
      `insert into vault_devices (user_id, vault_id, device_id, public_jwk, fingerprint, status) values ($1, $2, $3, $4, $5, 'pending') returning id`,
      [session.user_id, vault.id, session.device_id, jwk, fingerprint],
    );
    await recordEvent({ type: 'cloud.device_registered', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    return { id: row!.id, status: 'pending' as const, fingerprint };
  });
}

/**
 * Approves a pending browser. The approving browser must itself be active and
 * sends the fingerprint it displayed (computed from the public key the server
 * returned), which must match the server's record of that key.
 */
export async function approveVaultDevice(session: SessionRecord, targetId: string, input: { envelope: unknown; fingerprint: unknown }, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  requireFreshReauth(session);
  if (!UUID.test(targetId)) throw new UserFacingError('not_found', 'Device not found.', 404);
  assertEnvelope(input.envelope);
  const envelope = input.envelope;
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const target = await one<{ id: string; status: string; fingerprint: string; device_id: string }>(
      `select id, status, fingerprint, device_id from vault_devices where id = $1 for update`,
      [targetId],
    );
    if (!target || target.status !== 'pending') throw new UserFacingError('not_pending', 'That device isn’t waiting for approval.', 409);
    if (input.fingerprint !== target.fingerprint) throw new UserFacingError('fingerprint_mismatch', 'The security code doesn’t match that device.', 409);
    await query(`update vault_devices set status = 'active', envelope = $2, approved_via = 'device', approved_at = now() where id = $1`, [targetId, envelope]);
    await recordEvent(
      { type: 'cloud.device_approved', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { approvedDevice: target.device_id } },
      ctx,
    );
    return { ok: true };
  });
}

/** Ciphertext of the vault key under the recovery key; useless without the 256-bit recovery key. */
export async function getRecoveryEnvelope(session: SessionRecord) {
  assertCloudSession(session, 'read');
  return asUser(session.user_id, () =>
    one<{ vault_id: string; recovery_envelope: string }>(`select id as vault_id, recovery_envelope from vaults where user_id = $1`, [session.user_id]),
  );
}

/** This browser unwrapped the vault key with the recovery key and wrapped it to its own device key. */
export async function recoverVaultDevice(session: SessionRecord, input: { envelope: unknown; recoveryProof: unknown }, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  requireFreshReauth(session);
  assertEnvelope(input.envelope);
  const envelope = input.envelope;
  const digest = proofDigest(input.recoveryProof);
  return asUser(session.user_id, async () => {
    const dev = await vaultDeviceFor(session);
    if (!dev || dev.status !== 'pending') throw new UserFacingError('not_pending', 'Register this device first.', 409);
    const v = await one<{ recovery_verifier: Buffer }>(`select recovery_verifier from vaults where id = $1`, [dev.vault_id]);
    if (!v || !timingSafeEqual(v.recovery_verifier, digest)) {
      throw new UserFacingError('recovery_mismatch', 'That recovery key doesn’t unlock this vault.', 403);
    }
    await query(`update vault_devices set status = 'active', envelope = $2, approved_via = 'recovery', approved_at = now() where id = $1`, [dev.id, envelope]);
    await recordEvent({ type: 'cloud.recovery_used', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    return { ok: true };
  });
}

export async function revokeVaultDevice(session: SessionRecord, targetId: string, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  requireFreshReauth(session);
  if (!UUID.test(targetId)) throw new UserFacingError('not_found', 'Device not found.', 404);
  return asUser(session.user_id, async () => {
    const row = await one<{ device_id: string }>(
      `update vault_devices set status = 'revoked', envelope = null, revoked_at = now() where id = $1 and status <> 'revoked' returning device_id`,
      [targetId],
    );
    if (!row) throw new UserFacingError('not_found', 'Device not found.', 404);
    await recordEvent(
      { type: 'cloud.device_revoked', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { revokedDevice: row.device_id } },
      ctx,
    );
    return { ok: true };
  });
}

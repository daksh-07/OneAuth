import 'server-only';
import { createHash } from 'node:crypto';
import { asUser, one, query } from '../db';
import { UserFacingError } from '../errors';
import { recordEvent, type RequestContext } from '../events';
import { rateLimit } from '../ratelimit';
import { requireFreshReauth } from '../webauthn';
import type { SessionRecord } from '../sessions';
import { assertCloudSession, requireActiveVaultDevice } from './access';

/**
 * Staged vault-key rotation (docs/cloud/key-rotation.md). The server never sees
 * either vault key: it stores the client's re-wrapped material in next_*
 * columns and swaps it in atomically at commit, once nothing is missing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64_KW = /^[A-Za-z0-9+/]{54}==$/;
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const SEALED = /^[A-Za-z0-9+/]+={0,2}$/;
const JWE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){4}$/;
export const BATCH_LIMIT = 200;

const invalid = (what: string) => new UserFacingError('invalid', `Invalid ${what}.`);

interface Rotation {
  id: string;
  vault_id: string;
  from_version: number;
  to_version: number;
  reason: string;
}

async function openRotation(rotationId?: unknown): Promise<Rotation> {
  const r = await one<Rotation>(
    `select id, vault_id, from_version, to_version, reason from vault_rotations where status = 'in_progress'`,
  );
  if (!r) throw new UserFacingError('no_rotation', 'No key replacement is in progress.', 409);
  if (rotationId !== undefined && rotationId !== r.id) throw new UserFacingError('no_rotation', 'That key replacement has already finished.', 409);
  return r;
}

export async function rotationStatus(session: SessionRecord) {
  assertCloudSession(session, 'read');
  return asUser(session.user_id, async () => {
    const dev = await requireActiveVaultDevice(session);
    const r = await one<Rotation & { started_at: Date }>(
      `select id, vault_id, from_version, to_version, reason, started_at from vault_rotations where status = 'in_progress'`,
    );
    if (!r) return { rotation: null };
    const mine = await one<{ next_envelope: string | null }>(`select next_envelope from vault_devices where id = $1`, [dev.id]);
    return { rotation: { ...r, nextEnvelope: mine?.next_envelope ?? null, remaining: await remaining() } };
  });
}

async function remaining() {
  const row = await one<{ files: string; folders: string; items: string; devices: string }>(
    `select (select count(*) from cloud_files where next_wrapped_key is null) as files,
            (select count(*) from cloud_folders where next_encrypted_name is null) as folders,
            (select count(*) from space_items where next_encrypted_body is null) as items,
            (select count(*) from vault_devices where status = 'active' and next_envelope is null) as devices`,
  );
  return { files: Number(row!.files), folders: Number(row!.folders), items: Number(row!.items), devices: Number(row!.devices) };
}

/**
 * Starts a rotation. `envelopes` must cover exactly the browsers that are active
 * now (each gets the new vault key wrapped to its own public key, so offline
 * browsers are included); the recovery key is always replaced.
 */
export async function startRotation(
  session: SessionRecord,
  input: { reason: unknown; envelopes: unknown; recoveryEnvelope: unknown; recoveryProof: unknown; keyVersion: unknown },
  ctx: RequestContext,
) {
  assertCloudSession(session, 'write');
  requireFreshReauth(session);
  const reason = input.reason === 'device_removed' ? 'device_removed' : 'manual';
  if (!Array.isArray(input.envelopes) || input.envelopes.length === 0 || input.envelopes.length > 100) throw invalid('envelopes');
  const envelopes = new Map<string, string>();
  for (const e of input.envelopes as { vaultDeviceId?: unknown; envelope?: unknown }[]) {
    if (typeof e?.vaultDeviceId !== 'string' || !UUID.test(e.vaultDeviceId)) throw invalid('device');
    if (typeof e.envelope !== 'string' || e.envelope.length > 2000 || !JWE.test(e.envelope)) throw invalid('envelope');
    const header = JSON.parse(Buffer.from(e.envelope.split('.')[0], 'base64url').toString('utf8') || '{}');
    if (header.alg !== 'ECDH-ES+A256KW' || header.enc !== 'A256GCM') throw invalid('envelope');
    envelopes.set(e.vaultDeviceId.toLowerCase(), e.envelope);
  }
  if (typeof input.recoveryEnvelope !== 'string' || !B64_KW.test(input.recoveryEnvelope)) throw invalid('recovery envelope');
  if (typeof input.recoveryProof !== 'string' || !B64_32.test(input.recoveryProof)) throw invalid('recovery proof');
  const verifier = createHash('sha256').update(Buffer.from(input.recoveryProof, 'base64')).digest();
  await rateLimit(`cloud:rotate:${session.user_id}`, 5, 3600);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const vault = await one<{ id: string; key_version: number }>(`select id, key_version from vaults for update`);
    if (!vault) throw new UserFacingError('no_vault', 'Set up your encrypted vault first.', 409);
    if (Number(input.keyVersion) !== vault.key_version) throw new UserFacingError('stale_key', 'This browser is using an old vault key. Reload the page to continue.', 409);
    if (await one(`select 1 from vault_rotations where vault_id = $1 and status = 'in_progress'`, [vault.id])) {
      throw new UserFacingError('rotation_in_progress', 'A key replacement is already in progress.', 409);
    }
    const active = await query<{ id: string }>(`select id from vault_devices where status = 'active'`);
    const same = active.length === envelopes.size && active.every((d) => envelopes.has(d.id));
    if (!same) throw new UserFacingError('devices_changed', 'The browsers with access changed. Reload and try again.', 409);
    for (const [id, env] of envelopes) await query(`update vault_devices set next_envelope = $2 where id = $1`, [id, env]);
    const row = await one<{ id: string }>(
      `insert into vault_rotations (user_id, vault_id, from_version, to_version, status, reason, started_by, next_recovery_envelope, next_recovery_verifier)
       values ($1, $2, $3, $3 + 1, 'in_progress', $4, $5, $6, $7) returning id`,
      [session.user_id, vault.id, vault.key_version, reason, session.device_id, input.recoveryEnvelope, verifier],
    );
    await recordEvent({ type: 'cloud.rotation_started', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { reason } }, ctx);
    return { rotationId: row!.id, fromVersion: vault.key_version, toVersion: vault.key_version + 1 };
  });
}

/** Material still to be re-wrapped, in pages. Only for active browsers. */
export async function rotationWork(session: SessionRecord) {
  assertCloudSession(session, 'read');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const r = await openRotation();
    const files = await query<{ id: string; wrapped_key: string }>(
      `select id, wrapped_key from cloud_files where next_wrapped_key is null order by id limit $1`,
      [BATCH_LIMIT],
    );
    const folders = await query<{ id: string; encrypted_name: string }>(
      `select id, encrypted_name from cloud_folders where next_encrypted_name is null order by id limit $1`,
      [BATCH_LIMIT],
    );
    const items = await query<{ id: string; encrypted_body: string }>(
      `select id, encrypted_body from space_items where next_encrypted_body is null order by id limit $1`,
      [BATCH_LIMIT],
    );
    return { rotationId: r.id, files, folders, items, remaining: await remaining() };
  });
}

/** Stores re-wrapped material. Idempotent: resubmitting the same row overwrites its next_* value. */
export async function submitRotationBatch(
  session: SessionRecord,
  input: { rotationId: unknown; files?: unknown; folders?: unknown; items?: unknown },
) {
  assertCloudSession(session, 'write');
  const list = (v: unknown) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > BATCH_LIMIT) throw invalid('batch');
    return v as Record<string, unknown>[];
  };
  const files = list(input.files).map((f) => {
    if (typeof f.id !== 'string' || !UUID.test(f.id) || typeof f.wrappedKey !== 'string' || !B64_KW.test(f.wrappedKey)) throw invalid('file key');
    return [f.id, f.wrappedKey] as const;
  });
  const sealedList = (v: unknown, field: string, max: number) =>
    list(v).map((x) => {
      const val = x[field];
      if (typeof x.id !== 'string' || !UUID.test(x.id) || typeof val !== 'string' || val.length < 16 || val.length > max || !SEALED.test(val)) throw invalid(field);
      return [x.id, val] as const;
    });
  const folders = sealedList(input.folders, 'encryptedName', 1000);
  const items = sealedList(input.items, 'encryptedBody', 4000);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await openRotation(input.rotationId);
    let updated = 0;
    // RLS confines each update to this account; an ID from another account updates nothing.
    for (const [id, w] of files) updated += (await query(`update cloud_files set next_wrapped_key = $2 where id = $1 returning 1`, [id, w])).length;
    for (const [id, n] of folders) updated += (await query(`update cloud_folders set next_encrypted_name = $2 where id = $1 returning 1`, [id, n])).length;
    for (const [id, b] of items) updated += (await query(`update space_items set next_encrypted_body = $2 where id = $1 returning 1`, [id, b])).length;
    return { updated, remaining: await remaining() };
  });
}

/** Swaps every next_* value in at once, or refuses with what's still missing. */
export async function commitRotation(session: SessionRecord, input: { rotationId: unknown }, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await one(`select 1 from vaults for update`);
    const r = await openRotation(input.rotationId);
    const left = await remaining();
    if (left.files || left.folders || left.items || left.devices) {
      throw new UserFacingError('rotation_incomplete', 'Some items haven’t been re-encrypted yet.', 409, left);
    }
    await query(
      `update vaults v set key_version = r.to_version, recovery_envelope = r.next_recovery_envelope, recovery_verifier = r.next_recovery_verifier
         from vault_rotations r where r.id = $1 and v.id = r.vault_id`,
      [r.id],
    );
    await query(`update vault_devices set envelope = next_envelope, next_envelope = null where status = 'active'`);
    await query(`update vault_devices set next_envelope = null where next_envelope is not null`);
    await query(`update cloud_files set wrapped_key = next_wrapped_key, next_wrapped_key = null, key_version = $1`, [r.to_version]);
    await query(`update cloud_folders set encrypted_name = next_encrypted_name, next_encrypted_name = null, key_version = $1`, [r.to_version]);
    await query(`update space_items set encrypted_body = next_encrypted_body, next_encrypted_body = null, key_version = $1, version = version + 1`, [r.to_version]);
    await query(`update vault_rotations set status = 'committed', finished_at = now() where id = $1`, [r.id]);
    await recordEvent(
      {
        type: 'cloud.vault_rotated',
        userId: session.user_id,
        deviceId: session.device_id,
        sessionId: session.id,
        detail: { fromVersion: r.from_version, toVersion: r.to_version, reason: r.reason },
      },
      ctx,
    );
    return { ok: true, keyVersion: r.to_version };
  });
}

/** Abandons a rotation: every next_* value is discarded and the current keys stay authoritative. */
export async function abortRotation(session: SessionRecord, input: { rotationId: unknown }, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await one(`select 1 from vaults for update`);
    const r = await openRotation(input.rotationId);
    await query(`update vault_devices set next_envelope = null where next_envelope is not null`);
    await query(`update cloud_files set next_wrapped_key = null where next_wrapped_key is not null`);
    await query(`update cloud_folders set next_encrypted_name = null where next_encrypted_name is not null`);
    await query(`update space_items set next_encrypted_body = null where next_encrypted_body is not null`);
    await query(`update vault_rotations set status = 'aborted', finished_at = now() where id = $1`, [r.id]);
    await recordEvent({ type: 'cloud.rotation_aborted', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    return { ok: true };
  });
}

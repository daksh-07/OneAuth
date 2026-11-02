import 'server-only';
import { asUser, one, query } from '../db';
import { UserFacingError } from '../errors';
import { recordEvent, type RequestContext } from '../events';
import type { SessionRecord } from '../sessions';
import { encryptedSize } from '../../vault/crypto';
import { assertCloudSession, requireActiveVaultDevice } from './access';
import { release, reserve, settle } from './quota';
import { PART_SIZE, storage } from './storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Developer-preview limit: 25 MiB of plaintext per file. */
export const MAX_PLAINTEXT = 25 * 1024 * 1024;
export const MAX_OBJECT = encryptedSize(MAX_PLAINTEXT);

const notFound = () => new UserFacingError('not_found', 'That item wasn’t found.', 404);

function uuid(v: unknown, what = 'item'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new UserFacingError('invalid', `Invalid ${what}.`);
  return v.toLowerCase();
}
function sealed(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length < 16 || v.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) {
    throw new UserFacingError('invalid', 'Invalid encrypted field.');
  }
  return v;
}

export interface FolderRow {
  id: string;
  parent_id: string | null;
  encrypted_name: string;
  updated_at: Date;
  trashed_at: Date | null;
}
export interface FileRow {
  id: string;
  folder_id: string | null;
  size_bytes: string;
  part_count: number;
  encrypted_meta: string;
  wrapped_key: string;
  favorite: boolean;
  created_at: Date;
  updated_at: Date;
  trashed_at: Date | null;
}


/** Must run inside the tenant scope; folder must exist and not be in the trash. */
async function liveFolder(folderId: string | null) {
  if (folderId === null) return;
  const f = await one(`select 1 from cloud_folders where id = $1 and trashed_at is null`, [folderId]);
  if (!f) throw new UserFacingError('not_found', 'That folder wasn’t found.', 404);
}

// ---------------------------------------------------------------- listing

export type View = 'folder' | 'recent' | 'favorites' | 'trash';

export async function listItems(session: SessionRecord, input: { folderId: string | null; view: View }) {
  assertCloudSession(session, 'read');
  const folderId = input.folderId === null ? null : uuid(input.folderId, 'folder');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    let folders: FolderRow[] = [];
    let files: FileRow[] = [];
    let path: FolderRow[] = [];
    if (input.view === 'folder') {
      await liveFolder(folderId);
      folders = await query<FolderRow>(
        `select id, parent_id, encrypted_name, updated_at, trashed_at from cloud_folders
          where parent_id is not distinct from $1 and trashed_at is null`,
        [folderId],
      );
      files = await query<FileRow>(
        `select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files where folder_id is not distinct from $1 and status = 'ready' and trashed_at is null`,
        [folderId],
      );
      if (folderId) {
        path = await query<FolderRow>(
          `with recursive up as (
             select id, parent_id, encrypted_name, updated_at, trashed_at, 0 as depth from cloud_folders where id = $1
             union all
             select f.id, f.parent_id, f.encrypted_name, f.updated_at, f.trashed_at, up.depth + 1
               from cloud_folders f join up on f.id = up.parent_id where up.depth < 64)
           select id, parent_id, encrypted_name, updated_at, trashed_at from up order by depth desc`,
          [folderId],
        );
      }
    } else if (input.view === 'recent') {
      files = await query<FileRow>(
        `select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files where status = 'ready' and trashed_at is null order by updated_at desc limit 50`,
      );
    } else if (input.view === 'favorites') {
      files = await query<FileRow>(`select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files where status = 'ready' and trashed_at is null and favorite`);
    } else if (input.view === 'trash') {
      folders = await query<FolderRow>(`select id, parent_id, encrypted_name, updated_at, trashed_at from cloud_folders where trashed_at is not null`);
      files = await query<FileRow>(`select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files where status = 'ready' and trashed_at is not null`);
    } else {
      throw new UserFacingError('invalid', 'Unknown view.');
    }
    return { folders, files: files.map((f) => ({ ...f, size_bytes: Number(f.size_bytes) })), path };
  });
}

// ---------------------------------------------------------------- upload

export interface InitiateInput {
  fileId: unknown;
  folderId: unknown;
  size: unknown;
  sha256: unknown;
  encryptedMeta: unknown;
  wrappedKey: unknown;
}

/**
 * Starts an upload: validates every client-declared value, then reserves the
 * declared ciphertext size against the quota in the same transaction that
 * records the file. Nothing counts as stored until completeUpload verifies it.
 */
export async function initiateUpload(session: SessionRecord, input: InitiateInput, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  const fileId = uuid(input.fileId, 'file');
  const folderId = input.folderId == null ? null : uuid(input.folderId, 'folder');
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < encryptedSize(0) || size > MAX_OBJECT) {
    throw new UserFacingError('too_large', `Files can be up to ${MAX_PLAINTEXT / 1024 / 1024} MB during the preview.`, 413);
  }
  if (typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) throw new UserFacingError('invalid', 'Invalid checksum.');
  const meta = sealed(input.encryptedMeta, 4000);
  if (typeof input.wrappedKey !== 'string' || !/^[A-Za-z0-9+/]{54}==$/.test(input.wrappedKey)) throw new UserFacingError('invalid', 'Invalid file key.');
  const partCount = Math.ceil(size / PART_SIZE);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await liveFolder(folderId);
    await reserve(session.user_id, size);
    const row = await one<{ id: string }>(
      `insert into cloud_files (id, user_id, folder_id, status, size_bytes, part_count, sha256, encrypted_meta, wrapped_key, uploaded_by)
       values ($1, $2, $3, 'uploading', $4, $5, $6, $7, $8, $9) on conflict (id) do nothing returning id`,
      [fileId, session.user_id, folderId, size, partCount, Buffer.from(input.sha256 as string, 'hex'), meta, input.wrappedKey, session.device_id],
    );
    if (!row) throw new UserFacingError('conflict', 'That file ID is already in use.', 409);
    void ctx;
    return { fileId, partSize: PART_SIZE, partCount };
  });
}

/** Stores one transfer part. Each part must be exactly PART_SIZE bytes, except the last. */
export async function putPart(session: SessionRecord, fileIdRaw: string, idxRaw: string, data: Uint8Array) {
  assertCloudSession(session, 'write');
  const fileId = uuid(fileIdRaw, 'file');
  const idx = Number(idxRaw);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const f = await one<{ size_bytes: string; part_count: number; status: string }>(
      `select size_bytes, part_count, status from cloud_files where id = $1 for update`,
      [fileId],
    );
    if (!f || f.status !== 'uploading') throw notFound();
    if (!Number.isInteger(idx) || idx < 0 || idx >= f.part_count) throw new UserFacingError('invalid', 'Invalid part.');
    const size = Number(f.size_bytes);
    const expected = idx < f.part_count - 1 ? PART_SIZE : size - PART_SIZE * (f.part_count - 1);
    if (data.length !== expected) throw new UserFacingError('invalid_part', 'That part has the wrong size.', 400);
    const stored = await storage().putPart(session.user_id, fileId, idx, data);
    await query(`update cloud_files set stored_bytes = $2, updated_at = now() where id = $1`, [fileId, stored]);
    return { stored };
  });
}

/**
 * Finishes an upload: the server counts the stored bytes itself and checks the
 * SHA-256 of the whole ciphertext against the declared value before converting
 * the reservation into usage.
 */
export async function completeUpload(session: SessionRecord, fileIdRaw: string, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  const fileId = uuid(fileIdRaw, 'file');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    // Lock usage first, then the file (same order as reserve) to avoid deadlocks.
    await one(`select 1 from storage_usage where user_id = $1 for update`, [session.user_id]);
    const f = await one<{ size_bytes: string; part_count: number; status: string; sha256: Buffer }>(
      `select size_bytes, part_count, status, sha256 from cloud_files where id = $1 for update`,
      [fileId],
    );
    if (!f || f.status !== 'uploading') throw notFound();
    const d = await storage().digest(fileId);
    if (d.bytes !== Number(f.size_bytes) || d.parts !== f.part_count || !d.sha256.equals(f.sha256)) {
      throw new UserFacingError('integrity_mismatch', 'The upload didn’t arrive intact. Please try again.', 409);
    }
    await settle(session.user_id, Number(f.size_bytes));
    await query(`update cloud_files set status = 'ready', updated_at = now() where id = $1`, [fileId]);
    await recordEvent(
      { type: 'cloud.file_uploaded', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { bytes: Number(f.size_bytes) } },
      ctx,
    );
    return { ok: true };
  });
}

/** Downloads one part of a ready file. Only for active vault devices. */
export async function getPart(session: SessionRecord, fileIdRaw: string, idxRaw: string) {
  assertCloudSession(session, 'read');
  const fileId = uuid(fileIdRaw, 'file');
  const idx = Number(idxRaw);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const f = await one<{ part_count: number }>(`select part_count from cloud_files where id = $1 and status = 'ready'`, [fileId]);
    if (!f || !Number.isInteger(idx) || idx < 0 || idx >= f.part_count) throw notFound();
    const data = await storage().getPart(fileId, idx);
    if (!data) throw notFound();
    return data;
  });
}

// ---------------------------------------------------------------- changes

export async function updateFile(
  session: SessionRecord,
  fileIdRaw: string,
  input: { encryptedMeta?: unknown; folderId?: unknown; favorite?: unknown; trashed?: unknown },
  ctx: RequestContext,
) {
  assertCloudSession(session, 'write');
  const fileId = uuid(fileIdRaw, 'file');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const f = await one(`select 1 from cloud_files where id = $1 and status = 'ready' for update`, [fileId]);
    if (!f) throw notFound();
    if (input.encryptedMeta !== undefined) {
      await query(`update cloud_files set encrypted_meta = $2, updated_at = now() where id = $1`, [fileId, sealed(input.encryptedMeta, 4000)]);
    }
    if (input.folderId !== undefined) {
      const folderId = input.folderId === null ? null : uuid(input.folderId, 'folder');
      await liveFolder(folderId);
      await query(`update cloud_files set folder_id = $2, updated_at = now() where id = $1`, [fileId, folderId]);
    }
    if (typeof input.favorite === 'boolean') await query(`update cloud_files set favorite = $2 where id = $1`, [fileId, input.favorite]);
    if (typeof input.trashed === 'boolean') {
      await query(`update cloud_files set trashed_at = case when $2 then now() end where id = $1`, [fileId, input.trashed]);
      if (input.trashed) await recordEvent({ type: 'cloud.file_trashed', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    }
    return { ok: true };
  });
}

/** Cancels an unfinished upload or permanently deletes a file, releasing its quota. */
export async function deleteFile(session: SessionRecord, fileIdRaw: string, ctx: RequestContext) {
  assertCloudSession(session, 'write');
  const fileId = uuid(fileIdRaw, 'file');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await one(`select 1 from storage_usage where user_id = $1 for update`, [session.user_id]);
    const f = await one<{ size_bytes: string; status: string }>(`delete from cloud_files where id = $1 returning size_bytes, status`, [fileId]);
    if (!f) throw notFound();
    await storage().remove(fileId);
    await release(session.user_id, Number(f.size_bytes), f.status === 'ready' ? 'used' : 'reserved');
    if (f.status === 'ready') {
      await recordEvent({ type: 'cloud.file_deleted', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------- folders

export async function createFolder(session: SessionRecord, input: { id: unknown; parentId: unknown; encryptedName: unknown }) {
  assertCloudSession(session, 'write');
  const id = uuid(input.id, 'folder');
  const parentId = input.parentId == null ? null : uuid(input.parentId, 'folder');
  const name = sealed(input.encryptedName, 1000);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await liveFolder(parentId);
    const row = await one(
      `insert into cloud_folders (id, user_id, parent_id, encrypted_name) values ($1, $2, $3, $4) on conflict (id) do nothing returning id`,
      [id, session.user_id, parentId, name],
    );
    if (!row) throw new UserFacingError('conflict', 'That folder ID is already in use.', 409);
    return { id };
  });
}

export async function updateFolder(
  session: SessionRecord,
  idRaw: string,
  input: { encryptedName?: unknown; parentId?: unknown; trashed?: unknown },
) {
  assertCloudSession(session, 'write');
  const id = uuid(idRaw, 'folder');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    if (!(await one(`select 1 from cloud_folders where id = $1 for update`, [id]))) throw notFound();
    if (input.encryptedName !== undefined) {
      await query(`update cloud_folders set encrypted_name = $2, updated_at = now() where id = $1`, [id, sealed(input.encryptedName, 1000)]);
    }
    if (input.parentId !== undefined) {
      const parentId = input.parentId === null ? null : uuid(input.parentId, 'folder');
      if (parentId) {
        await liveFolder(parentId);
        // Refuse to move a folder into itself or any of its descendants.
        const cycle = await one(
          `with recursive up as (select id, parent_id, 0 as depth from cloud_folders where id = $1
             union all select f.id, f.parent_id, up.depth + 1 from cloud_folders f join up on f.id = up.parent_id where up.depth < 64)
           select 1 from up where id = $2`,
          [parentId, id],
        );
        if (cycle) throw new UserFacingError('invalid_move', 'A folder can’t be moved inside itself.', 409);
      }
      await query(`update cloud_folders set parent_id = $2, updated_at = now() where id = $1`, [id, parentId]);
    }
    if (typeof input.trashed === 'boolean') {
      await query(`update cloud_folders set trashed_at = case when $2 then now() end where id = $1`, [id, input.trashed]);
    }
    return { ok: true };
  });
}

/** Permanently deletes an empty folder. Non-empty folders must be emptied first, so no file is removed implicitly. */
export async function deleteFolder(session: SessionRecord, idRaw: string) {
  assertCloudSession(session, 'write');
  const id = uuid(idRaw, 'folder');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const busy = await one(
      `select 1 where exists (select 1 from cloud_folders where parent_id = $1) or exists (select 1 from cloud_files where folder_id = $1)`,
      [id],
    );
    if (busy) throw new UserFacingError('not_empty', 'Empty this folder before deleting it permanently.', 409);
    const row = await one(`delete from cloud_folders where id = $1 returning id`, [id]);
    if (!row) throw notFound();
    return { ok: true };
  });
}

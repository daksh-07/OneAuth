import 'server-only';
import { asUser, one, query } from '../db';
import { UserFacingError } from '../errors';
import { recordEvent, type RequestContext } from '../events';
import type { SessionRecord } from '../sessions';
import { encryptedSize } from '../../vault/crypto';
import { assertCloudSession, assertVaultKeyWritable, requireActiveVaultDevice } from './access';
import { release, reserve, settle } from './quota';
import { PART_SIZE, storage } from './storage';
import { rateLimit } from '../ratelimit';

/** Developer-preview cap on folders per account (rows are cheap but not free). */
export const MAX_FOLDERS = 5000;

/**
 * Serialises changes to one account's folder tree. The cycle check in
 * updateFolder reads the tree and then writes it; without this lock two
 * concurrent moves (A into B, B into A) can both pass and create a cycle.
 * Must run inside the tenant transaction (released at commit).
 */
async function lockTree(userId: string) {
  await one(`select pg_advisory_xact_lock(hashtextextended('oneauth.cloud-tree:' || $1, 0))`, [userId]);
}

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

export type View = 'folder' | 'recent' | 'favorites' | 'trash' | 'all';
/** Cap for the 'all' view (search and move targets) during the preview. */
export const MAX_LISTED = 2000;

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
        `with recursive hidden as (select id from cloud_folders where trashed_at is not null union select f.id from cloud_folders f join hidden h on f.parent_id = h.id)
         select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files
          where status = 'ready' and trashed_at is null and (folder_id is null or folder_id not in (select id from hidden))
          order by updated_at desc limit 50`,
      );
    } else if (input.view === 'favorites') {
      files = await query<FileRow>(`with recursive hidden as (select id from cloud_folders where trashed_at is not null union select f.id from cloud_folders f join hidden h on f.parent_id = h.id)
         select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files
          where status = 'ready' and trashed_at is null and favorite and (folder_id is null or folder_id not in (select id from hidden))`);
    } else if (input.view === 'all') {
      // Everything that isn't in the trash (directly or via a trashed folder): for search and "Move to…".
      folders = await query<FolderRow>(
        `with recursive hidden as (select id from cloud_folders where trashed_at is not null union select f.id from cloud_folders f join hidden h on f.parent_id = h.id)
         select id, parent_id, encrypted_name, updated_at, trashed_at from cloud_folders where id not in (select id from hidden) limit $1`,
        [MAX_LISTED],
      );
      files = await query<FileRow>(
        `with recursive hidden as (select id from cloud_folders where trashed_at is not null union select f.id from cloud_folders f join hidden h on f.parent_id = h.id)
         select id, folder_id, size_bytes, part_count, encrypted_meta, wrapped_key, favorite, created_at, updated_at, trashed_at from cloud_files
          where status = 'ready' and trashed_at is null and (folder_id is null or folder_id not in (select id from hidden)) limit $1`,
        [MAX_LISTED],
      );
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
  /** The vault-key version the client wrapped `wrappedKey` under. */
  keyVersion: unknown;
  /** Deep rotation: this upload is a re-encryption of that (ready) file and replaces it on completion. */
  replacesFileId?: unknown;
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
  const replaces = input.replacesFileId == null ? null : uuid(input.replacesFileId, 'file');
  await rateLimit(`cloud:upload:${session.user_id}`, 300, 600);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const v = await assertVaultKeyWritable(input.keyVersion);
    // Uploading into a folder races with deleting that folder (files cascade with it).
    if (folderId) await lockTree(session.user_id);
    await liveFolder(folderId);
    if (replaces && !(await one(`select 1 from cloud_files where id = $1 and status = 'ready'`, [replaces]))) throw notFound();
    await reserve(session.user_id, size);
    const row = await one<{ id: string }>(
      `insert into cloud_files (id, user_id, folder_id, status, size_bytes, part_count, sha256, encrypted_meta, wrapped_key, uploaded_by, key_version,
                                content_version, replaces_file_id)
       values ($1, $2, $3, 'uploading', $4, $5, $6, $7, $8, $9, $10, $10, $11) on conflict do nothing returning id`,
      [fileId, session.user_id, folderId, size, partCount, Buffer.from(input.sha256 as string, 'hex'), meta, input.wrappedKey, session.device_id, v.key_version, replaces],
    );
    // Either the ID is taken or that file already has a re-encryption in progress (unique index).
    if (!row) throw new UserFacingError('conflict', replaces ? 'That file is already being re-encrypted.' : 'That file ID is already in use.', 409);
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
    // Lock order everywhere: folder tree, then usage, then rows. A re-encryption
    // swap needs the tree lock (it moves pins and folder placement), so take it first.
    const pre = await one<{ replaces_file_id: string | null }>(`select replaces_file_id from cloud_files where id = $1`, [fileId]);
    if (pre?.replaces_file_id) await lockTree(session.user_id);
    await one(`select 1 from storage_usage where user_id = $1 for update`, [session.user_id]);
    const f = await one<{ size_bytes: string; part_count: number; status: string; sha256: Buffer; replaces_file_id: string | null; created_at: Date }>(
      `select size_bytes, part_count, status, sha256, replaces_file_id, created_at from cloud_files where id = $1 for update`,
      [fileId],
    );
    if (!f || f.status !== 'uploading') throw notFound();
    const d = await storage().digest(fileId);
    if (d.bytes !== Number(f.size_bytes) || d.parts !== f.part_count || !d.sha256.equals(f.sha256)) {
      throw new UserFacingError('integrity_mismatch', 'The upload didn’t arrive intact. Please try again.', 409);
    }
    await settle(session.user_id, Number(f.size_bytes));
    if (f.replaces_file_id) {
      await swapReencrypted(session.user_id, fileId, f.replaces_file_id, f.created_at);
      await recordEvent({ type: 'cloud.file_reencrypted', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, ctx);
      return { ok: true, replaced: f.replaces_file_id };
    }
    await query(`update cloud_files set status = 'ready', updated_at = now() where id = $1`, [fileId]);
    await recordEvent(
      { type: 'cloud.file_uploaded', userId: session.user_id, deviceId: session.device_id, sessionId: session.id, detail: { bytes: Number(f.size_bytes) } },
      ctx,
    );
    return { ok: true };
  });
}

/**
 * Deep rotation, final step (inside completeUpload's transaction, usage row
 * already locked): the verified re-encrypted object takes the old file's
 * place in one step, so the vault is never without a readable copy. Refused
 * if the old file went away or changed (renamed or moved) since the
 * re-encryption started; the client then starts again from the current version.
 */
async function swapReencrypted(userId: string, newId: string, oldId: string, startedAt: Date) {
  // Caller holds the tree and usage locks (in that order).
  const old = await one<{ size_bytes: string; status: string; updated_at: Date }>(
    `select size_bytes, status, updated_at from cloud_files where id = $1 for update`,
    [oldId],
  );
  if (!old || old.status !== 'ready') {
    throw new UserFacingError('replace_target_gone', 'The original file was deleted while it was being re-encrypted.', 409);
  }
  if (old.updated_at > startedAt) {
    throw new UserFacingError('changed_during_reencrypt', 'The file changed while it was being re-encrypted. Try again.', 409);
  }
  await query(
    `update cloud_files n set status = 'ready', replaces_file_id = null, folder_id = o.folder_id, favorite = o.favorite,
            trashed_at = o.trashed_at, created_at = o.created_at, updated_at = o.updated_at
       from cloud_files o where n.id = $1 and o.id = $2`,
    [newId, oldId],
  );
  await query(`update space_pins set file_id = $1 where file_id = $2`, [newId, oldId]);
  await query(`delete from cloud_files where id = $1`, [oldId]); // parts cascade
  await storage().remove(oldId);
  await release(userId, Number(old.size_bytes), 'used');
}

/** Files whose contents were encrypted under an earlier vault key (deep rotation candidates). */
export async function staleContent(session: SessionRecord) {
  assertCloudSession(session, 'read');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const files = await query<FileRow>(
      `select f.id, f.folder_id, f.size_bytes, f.part_count, f.encrypted_meta, f.wrapped_key, f.favorite, f.created_at, f.updated_at, f.trashed_at
         from cloud_files f, vaults v
        where f.status = 'ready' and f.content_version < v.key_version
          and not exists (select 1 from cloud_files r where r.replaces_file_id = f.id)
        order by f.size_bytes limit $1`,
      [MAX_LISTED],
    );
    return { files: files.map((f) => ({ ...f, size_bytes: Number(f.size_bytes) })) };
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
    if (input.folderId !== undefined) await lockTree(session.user_id); // before any row lock (lock order)
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
      // Restoring into a folder that is itself in the trash would hide it: restore to the top level instead.
      if (!input.trashed) {
        await query(
          `update cloud_files set folder_id = null where id = $1 and folder_id in (select id from cloud_folders where trashed_at is not null)`,
          [fileId],
        );
      }
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

export async function createFolder(session: SessionRecord, input: { id: unknown; parentId: unknown; encryptedName: unknown; keyVersion: unknown }) {
  assertCloudSession(session, 'write');
  const id = uuid(input.id, 'folder');
  const parentId = input.parentId == null ? null : uuid(input.parentId, 'folder');
  const name = sealed(input.encryptedName, 1000);
  await rateLimit(`cloud:folder:${session.user_id}`, 200, 600);
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    const v = await assertVaultKeyWritable(input.keyVersion);
    await lockTree(session.user_id);
    await liveFolder(parentId);
    const n = await one<{ n: string }>(`select count(*) as n from cloud_folders`);
    if (Number(n!.n) >= MAX_FOLDERS) throw new UserFacingError('limit', `You can have up to ${MAX_FOLDERS} folders during the preview.`, 409);
    const row = await one(
      `insert into cloud_folders (id, user_id, parent_id, encrypted_name, key_version) values ($1, $2, $3, $4, $5) on conflict (id) do nothing returning id`,
      [id, session.user_id, parentId, name, v.key_version],
    );
    if (!row) throw new UserFacingError('conflict', 'That folder ID is already in use.', 409);
    return { id };
  });
}

export async function updateFolder(
  session: SessionRecord,
  idRaw: string,
  input: { encryptedName?: unknown; parentId?: unknown; trashed?: unknown; keyVersion?: unknown },
) {
  assertCloudSession(session, 'write');
  const id = uuid(idRaw, 'folder');
  return asUser(session.user_id, async () => {
    await requireActiveVaultDevice(session);
    await lockTree(session.user_id);
    if (!(await one(`select 1 from cloud_folders where id = $1 for update`, [id]))) throw notFound();
    if (input.encryptedName !== undefined) {
      await assertVaultKeyWritable(input.keyVersion);
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
      if (!input.trashed) {
        await query(
          `update cloud_folders set parent_id = null where id = $1 and parent_id in (select id from cloud_folders where trashed_at is not null)`,
          [id],
        );
      }
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
    await lockTree(session.user_id);
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

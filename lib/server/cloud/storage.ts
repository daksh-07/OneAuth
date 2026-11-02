import 'server-only';
import { createHash } from 'node:crypto';
import { one, query } from '../db';

/**
 * Object storage for ciphertext. Drivers store opaque bytes in fixed-size
 * transfer parts; they never see keys or plaintext.
 *
 * - `postgres` (implemented, developer preview): parts in cloud_object_parts,
 *   uploaded through authenticated API requests of at most PART_SIZE bytes.
 * - `s3` (designed, not implemented): direct-to-bucket multipart uploads with
 *   short-lived, single-object, size-bounded presigned URLs (e.g. Cloudflare R2).
 *   See docs/cloud/security-design.md §6.
 */
export const PART_SIZE = 1024 * 1024;

export interface StorageDriver {
  putPart(userId: string, fileId: string, idx: number, data: Uint8Array): Promise<number>;
  getPart(fileId: string, idx: number): Promise<Uint8Array | null>;
  /** Total bytes and SHA-256 over all parts in order (server-side integrity check). */
  digest(fileId: string): Promise<{ bytes: number; parts: number; sha256: Buffer }>;
  remove(fileId: string): Promise<void>;
}

/** Must run inside the user's tenant scope (RLS applies to the parts table). */
export const postgresDriver: StorageDriver = {
  async putPart(userId, fileId, idx, data) {
    await query(
      `insert into cloud_object_parts (file_id, user_id, idx, data) values ($1, $2, $3, $4)
       on conflict (file_id, idx) do update set data = excluded.data`,
      [fileId, userId, idx, Buffer.from(data)],
    );
    const row = await one<{ n: string }>(`select coalesce(sum(length(data)), 0) as n from cloud_object_parts where file_id = $1`, [fileId]);
    return Number(row!.n);
  },
  async getPart(fileId, idx) {
    const row = await one<{ data: Buffer }>(`select data from cloud_object_parts where file_id = $1 and idx = $2`, [fileId, idx]);
    return row ? new Uint8Array(row.data) : null;
  },
  async digest(fileId) {
    const hash = createHash('sha256');
    let bytes = 0;
    let parts = 0;
    // One part at a time keeps memory bounded.
    for (let idx = 0; ; idx++) {
      const row = await one<{ data: Buffer }>(`select data from cloud_object_parts where file_id = $1 and idx = $2`, [fileId, idx]);
      if (!row) break;
      hash.update(row.data);
      bytes += row.data.length;
      parts++;
    }
    return { bytes, parts, sha256: hash.digest() };
  },
  async remove(fileId) {
    await query(`delete from cloud_object_parts where file_id = $1`, [fileId]);
  },
};

export function storage(): StorageDriver {
  const driver = process.env.ONEAUTH_STORAGE_DRIVER ?? 'postgres';
  if (driver !== 'postgres') throw new Error(`Storage driver "${driver}" is not implemented`);
  return postgresDriver;
}

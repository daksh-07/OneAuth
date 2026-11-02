import 'server-only';
import { asUser, one, query } from './db';
import { UserFacingError } from './errors';
import { hasScope } from '../scopes';
import type { SessionRecord } from './sessions';
import { assertVaultKeyWritable, cloudEnabled, requireActiveVaultDevice, vaultDeviceFor } from './cloud/access';
import { rateLimit } from './ratelimit';

/**
 * OneAuth Space: named workspaces (e.g. Personal, Work) with pinned Cloud
 * items, each visible on all of the person's devices or only on chosen ones.
 * Device visibility is enforced here on every read, not only in the UI.
 */

export const KINDS = ['personal', 'work', 'study', 'other'] as const;
export const ACCENTS = ['blue', 'green', 'amber', 'rose', 'violet', 'slate'] as const;
export const MAX_SPACES = 12;
export const MAX_PINS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SpaceRow {
  id: string;
  name: string;
  kind: (typeof KINDS)[number];
  accent: (typeof ACCENTS)[number];
  all_devices: boolean;
  position: number;
  device_ids: string[];
  prefs: SpacePrefs;
}

/** Non-sensitive per-space preferences, validated here (unknown keys are dropped). */
export interface SpacePrefs {
  cloudSort?: 'name' | 'updated' | 'size';
  linksInNewTab?: boolean;
}
export const MAX_ITEMS = 200;

function cleanPrefs(input: unknown): SpacePrefs {
  if (!input || typeof input !== 'object') throw new UserFacingError('invalid', 'Invalid preferences.');
  const p = input as Record<string, unknown>;
  const out: SpacePrefs = {};
  if (p.cloudSort !== undefined) {
    if (p.cloudSort !== 'name' && p.cloudSort !== 'updated' && p.cloudSort !== 'size') throw new UserFacingError('invalid', 'Invalid sort order.');
    out.cloudSort = p.cloudSort;
  }
  if (p.linksInNewTab !== undefined) {
    if (typeof p.linksInNewTab !== 'boolean') throw new UserFacingError('invalid', 'Invalid link preference.');
    out.linksInNewTab = p.linksInNewTab;
  }
  return out;
}

function assertSpaceSession(session: SessionRecord, mode: 'read' | 'write') {
  if (session.kind !== 'primary' || session.device_kind !== 'owned' || !hasScope(session.scopes, mode === 'read' ? 'space:read' : 'space:write')) {
    throw new UserFacingError('forbidden', 'Spaces are available on your own devices, signed in with your passkey.', 403);
  }
}

function id(v: unknown, what = 'space'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new UserFacingError('not_found', `That ${what} wasn’t found.`, 404);
  return v.toLowerCase();
}

function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 60) throw new UserFacingError('invalid', 'Give the space a name of up to 60 characters.');
  return name;
}

/** Spaces this device may see, in the tenant scope. */
function visibleSpaces(deviceId: string) {
  return query<SpaceRow>(
    `select s.id, s.name, s.kind, s.accent, s.all_devices, s.position, s.prefs,
            coalesce(array_agg(sd.device_id::text) filter (where sd.device_id is not null), '{}') as device_ids
       from spaces s left join space_devices sd on sd.space_id = s.id
      group by s.id
     having s.all_devices or bool_or(sd.device_id = $1)
      order by s.position, s.created_at`,
    [deviceId],
  );
}

async function visibleSpace(deviceId: string, spaceId: string) {
  const row = await one<{ id: string }>(
    `select s.id from spaces s where s.id = $1 and (s.all_devices or exists (select 1 from space_devices d where d.space_id = s.id and d.device_id = $2))`,
    [spaceId, deviceId],
  );
  if (!row) throw new UserFacingError('not_found', 'That space wasn’t found.', 404);
}

/**
 * Lists this device's spaces and the selected one, creating a first
 * "Personal" space when the account has none.
 */
export async function listSpaces(session: SessionRecord) {
  assertSpaceSession(session, 'read');
  return asUser(session.user_id, async () => {
    const any = await one(`select 1 from spaces limit 1`);
    if (!any) await query(`insert into spaces (user_id, name, kind) values ($1, 'Personal', 'personal')`, [session.user_id]);
    const spaces = await visibleSpaces(session.device_id);
    const sel = await one<{ space_id: string }>(`select space_id from space_selection where device_id = $1`, [session.device_id]);
    const selectedId = spaces.find((s) => s.id === sel?.space_id)?.id ?? spaces[0]?.id ?? null;
    const devices = await query<{ id: string; name: string; kind: string }>(
      `select id, name, kind from devices where revoked_at is null and kind = 'owned' order by created_at`,
    );
    return { spaces, selectedId, devices };
  });
}

export async function selectSpace(session: SessionRecord, spaceId: unknown) {
  assertSpaceSession(session, 'read');
  const sid = id(spaceId);
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    await query(
      `insert into space_selection (device_id, user_id, space_id) values ($1, $2, $3)
       on conflict (device_id) do update set space_id = excluded.space_id`,
      [session.device_id, session.user_id, sid],
    );
    return { ok: true };
  });
}

export async function createSpace(session: SessionRecord, input: { name: unknown; kind: unknown }) {
  assertSpaceSession(session, 'write');
  const name = cleanName(input.name);
  const kind = KINDS.includes(input.kind as never) ? (input.kind as string) : 'other';
  return asUser(session.user_id, async () => {
    const n = await one<{ n: string }>(`select count(*) as n from spaces`);
    if (Number(n!.n) >= MAX_SPACES) throw new UserFacingError('limit', `You can have up to ${MAX_SPACES} spaces.`, 409);
    const row = await one<{ id: string }>(
      `insert into spaces (user_id, name, kind, position) values ($1, $2, $3, $4) returning id`,
      [session.user_id, name, kind, Number(n!.n)],
    );
    await query(
      `insert into space_selection (device_id, user_id, space_id) values ($1, $2, $3)
       on conflict (device_id) do update set space_id = excluded.space_id`,
      [session.device_id, session.user_id, row!.id],
    );
    return { id: row!.id };
  });
}

export async function updateSpace(
  session: SessionRecord,
  spaceId: unknown,
  input: { name?: unknown; kind?: unknown; accent?: unknown; allDevices?: unknown; deviceIds?: unknown; prefs?: unknown },
) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    if (input.name !== undefined) await query(`update spaces set name = $2, updated_at = now() where id = $1`, [sid, cleanName(input.name)]);
    if (input.kind !== undefined) {
      if (!KINDS.includes(input.kind as never)) throw new UserFacingError('invalid', 'Unknown space type.');
      await query(`update spaces set kind = $2, updated_at = now() where id = $1`, [sid, input.kind]);
    }
    if (input.accent !== undefined) {
      if (!ACCENTS.includes(input.accent as never)) throw new UserFacingError('invalid', 'Unknown colour.');
      await query(`update spaces set accent = $2, updated_at = now() where id = $1`, [sid, input.accent]);
    }
    if (input.prefs !== undefined) {
      await query(`update spaces set prefs = prefs || $2::jsonb, updated_at = now() where id = $1`, [sid, JSON.stringify(cleanPrefs(input.prefs))]);
    }
    if (input.allDevices !== undefined) {
      if (input.allDevices === true) {
        await query(`update spaces set all_devices = true, updated_at = now() where id = $1`, [sid]);
        await query(`delete from space_devices where space_id = $1`, [sid]);
      } else {
        if (!Array.isArray(input.deviceIds)) throw new UserFacingError('invalid', 'Choose which devices show this space.');
        const ids = [...new Set(input.deviceIds.map((d) => id(d, 'device')))];
        if (!ids.length) throw new UserFacingError('invalid', 'Choose at least one device.');
        // Only the account's own, active, owned devices (RLS also confines this to the user).
        const valid = await query<{ id: string }>(`select id from devices where id = any($1::uuid[]) and revoked_at is null and kind = 'owned'`, [ids]);
        if (valid.length !== ids.length) throw new UserFacingError('invalid', 'One of those devices isn’t available.');
        await query(`update spaces set all_devices = false, updated_at = now() where id = $1`, [sid]);
        await query(`delete from space_devices where space_id = $1`, [sid]);
        await query(
          `insert into space_devices (space_id, device_id, user_id) select $1, unnest($2::uuid[]), $3`,
          [sid, ids, session.user_id],
        );
      }
    }
    return { ok: true };
  });
}

export async function deleteSpace(session: SessionRecord, spaceId: unknown) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    const n = await one<{ n: string }>(`select count(*) as n from spaces`);
    if (Number(n!.n) <= 1) throw new UserFacingError('last_space', 'You need at least one space.', 409);
    await query(`delete from spaces where id = $1`, [sid]);
    return { ok: true };
  });
}

/** Pinned items for a space, with the encrypted fields the browser needs to show and open them. */
export async function listPins(session: SessionRecord, spaceId: unknown) {
  assertSpaceSession(session, 'read');
  const sid = id(spaceId);
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    // Wrapped file keys, encrypted metadata and sizes go only to browsers with
    // vault access (the same rule as Cloud itself). Others learn only that
    // something is pinned, so they can explain why it's locked.
    const dev = cloudEnabled() ? await vaultDeviceFor(session) : null;
    if (dev?.status !== 'active') {
      const n = await one<{ n: string }>(
        `select count(*) as n from space_pins p
           left join cloud_files f on f.id = p.file_id left join cloud_folders c on c.id = p.folder_id
          where p.space_id = $1 and ((f.id is not null and f.status = 'ready' and f.trashed_at is null) or (c.id is not null and c.trashed_at is null))`,
        [sid],
      );
      return { files: [], folders: [], locked: true, lockedCount: Number(n!.n) };
    }
    const files = await query(
      `select p.id as pin_id, f.id, f.folder_id, f.size_bytes::float8 as size_bytes, f.part_count, f.encrypted_meta, f.wrapped_key, f.favorite,
              f.created_at, f.updated_at, f.trashed_at
         from space_pins p join cloud_files f on f.id = p.file_id
        where p.space_id = $1 and f.status = 'ready' and f.trashed_at is null
        order by p.position, p.created_at`,
      [sid],
    );
    const folders = await query(
      `select p.id as pin_id, c.id, c.parent_id, c.encrypted_name, c.updated_at, c.trashed_at
         from space_pins p join cloud_folders c on c.id = p.folder_id
        where p.space_id = $1 and c.trashed_at is null
        order by p.position, p.created_at`,
      [sid],
    );
    return { files, folders, locked: false, lockedCount: 0 };
  });
}

export async function pinItem(session: SessionRecord, spaceId: unknown, input: { fileId?: unknown; folderId?: unknown }) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  const fileId = input.fileId == null ? null : id(input.fileId, 'file');
  const folderId = input.folderId == null ? null : id(input.folderId, 'folder');
  if ((fileId === null) === (folderId === null)) throw new UserFacingError('invalid', 'Pin one file or folder.');
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    const exists = fileId
      ? await one(`select 1 from cloud_files where id = $1 and status = 'ready'`, [fileId])
      : await one(`select 1 from cloud_folders where id = $1`, [folderId]);
    if (!exists) throw new UserFacingError('not_found', 'That item wasn’t found.', 404);
    const n = await one<{ n: string }>(`select count(*) as n from space_pins where space_id = $1`, [sid]);
    if (Number(n!.n) >= MAX_PINS) throw new UserFacingError('limit', `A space can hold up to ${MAX_PINS} pins.`, 409);
    await query(
      `insert into space_pins (space_id, user_id, file_id, folder_id, position) values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [sid, session.user_id, fileId, folderId, Number(n!.n)],
    );
    return { ok: true };
  });
}

export async function unpin(session: SessionRecord, spaceId: unknown, pinId: unknown) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  const pid = id(pinId, 'pin');
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    const row = await one(`delete from space_pins where id = $1 and space_id = $2 returning id`, [pid, sid]);
    if (!row) throw new UserFacingError('not_found', 'That pin wasn’t found.', 404);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- encrypted items (bookmarks, shortcuts)

const SEALED = /^[A-Za-z0-9+/]+={0,2}$/;
function sealedBody(v: unknown): string {
  if (typeof v !== 'string' || v.length < 16 || v.length > 4000 || !SEALED.test(v)) throw new UserFacingError('invalid', 'Invalid encrypted item.');
  return v;
}

/**
 * Bookmarks and shortcuts are end-to-end encrypted with a key derived from the
 * vault key, so only browsers with vault access receive them. Others learn only
 * how many there are, so the page can explain why they're locked.
 */
export async function listSpaceItems(session: SessionRecord, spaceId: unknown) {
  assertSpaceSession(session, 'read');
  const sid = id(spaceId);
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    const dev = cloudEnabled() ? await vaultDeviceFor(session) : null;
    if (dev?.status !== 'active') {
      const n = await one<{ n: string }>(`select count(*) as n from space_items where space_id = $1`, [sid]);
      return { items: [], locked: true, lockedCount: Number(n!.n) };
    }
    const items = await query<{ id: string; kind: string; encrypted_body: string; position: number; version: number; updated_at: Date }>(
      `select id, kind, encrypted_body, position, version, updated_at from space_items where space_id = $1 order by kind, position, created_at`,
      [sid],
    );
    return { items, locked: false, lockedCount: 0 };
  });
}

async function writableItemScope(session: SessionRecord, sid: string, keyVersion: unknown) {
  await visibleSpace(session.device_id, sid);
  if (!cloudEnabled()) throw new UserFacingError('cloud_unavailable', 'Encrypted Space items need OneAuth Cloud, which isn’t available here.', 404);
  await requireActiveVaultDevice(session);
  await assertVaultKeyWritable(keyVersion);
}

export async function createSpaceItem(session: SessionRecord, spaceId: unknown, input: { id: unknown; kind: unknown; encryptedBody: unknown; keyVersion: unknown }) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  const itemId = id(input.id, 'item');
  if (input.kind !== 'bookmark' && input.kind !== 'shortcut') throw new UserFacingError('invalid', 'Unknown item type.');
  const body = sealedBody(input.encryptedBody);
  await rateLimit(`space:item:${session.user_id}`, 120, 600);
  return asUser(session.user_id, async () => {
    const v = await writableItemScope(session, sid, input.keyVersion);
    const n = await one<{ n: string }>(`select count(*) as n from space_items where space_id = $1`, [sid]);
    if (Number(n!.n) >= MAX_ITEMS) throw new UserFacingError('limit', `A space can hold up to ${MAX_ITEMS} bookmarks and shortcuts.`, 409);
    const row = await one<{ id: string; version: number }>(
      `insert into space_items (id, space_id, user_id, kind, encrypted_body, key_version, position)
       values ($1, $2, $3, $4, $5, (select key_version from vaults), $6) on conflict (id) do nothing returning id, version`,
      [itemId, sid, session.user_id, input.kind, body, Number(n!.n)],
    );
    void v;
    if (!row) throw new UserFacingError('conflict', 'That item ID is already in use.', 409);
    return row;
  });
}

/**
 * Updates an item if nobody else changed it first: `version` must match, so two
 * browsers editing at once can't silently overwrite each other.
 */
export async function updateSpaceItem(
  session: SessionRecord,
  spaceId: unknown,
  itemId: unknown,
  input: { encryptedBody?: unknown; position?: unknown; version: unknown; keyVersion?: unknown },
) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  const iid = id(itemId, 'item');
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) throw new UserFacingError('invalid', 'Invalid version.');
  const body = input.encryptedBody === undefined ? null : sealedBody(input.encryptedBody);
  const position = input.position === undefined ? null : Number(input.position);
  if (position !== null && (!Number.isInteger(position) || position < 0 || position > 10_000)) throw new UserFacingError('invalid', 'Invalid position.');
  return asUser(session.user_id, async () => {
    if (body !== null) await writableItemScope(session, sid, input.keyVersion);
    else {
      await visibleSpace(session.device_id, sid);
      await requireActiveVaultDevice(session);
    }
    const row = await one<{ version: number }>(
      `update space_items set encrypted_body = coalesce($4, encrypted_body), position = coalesce($5, position),
              version = version + 1, updated_at = now()
        where id = $1 and space_id = $2 and version = $3 returning version`,
      [iid, sid, version, body, position],
    );
    if (!row) {
      const exists = await one(`select 1 from space_items where id = $1 and space_id = $2`, [iid, sid]);
      if (!exists) throw new UserFacingError('not_found', 'That item wasn’t found.', 404);
      throw new UserFacingError('conflict', 'This item was changed on another browser. Showing the latest version.', 409);
    }
    return row;
  });
}

export async function deleteSpaceItem(session: SessionRecord, spaceId: unknown, itemId: unknown) {
  assertSpaceSession(session, 'write');
  const sid = id(spaceId);
  const iid = id(itemId, 'item');
  return asUser(session.user_id, async () => {
    await visibleSpace(session.device_id, sid);
    await requireActiveVaultDevice(session);
    const row = await one(`delete from space_items where id = $1 and space_id = $2 returning id`, [iid, sid]);
    if (!row) throw new UserFacingError('not_found', 'That item wasn’t found.', 404);
    return { ok: true };
  });
}

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../helpers/admin';
import { createUser, signIn } from '../helpers/fixtures';
import { validateSessionToken } from '@/lib/server/sessions';
import * as space from '@/lib/server/space';
import { setUpVault } from '../helpers/cloud';

beforeAll(() => {
  process.env.ONEAUTH_CLOUD_PREVIEW = '1';
});

async function secondDevice(user: Awaited<ReturnType<typeof createUser>>) {
  const res = await signIn(user);
  return async () => (await validateSessionToken(res.token))!;
}

/** A ready Cloud file row for pin tests (content is irrelevant here). */
async function cloudFile(userId: string) {
  const id = randomUUID();
  await query(
    `insert into cloud_files (id, user_id, status, size_bytes, part_count, sha256, encrypted_meta, wrapped_key)
     values ($1, $2, 'ready', 100, 1, decode(repeat('00', 32), 'hex'), $3, $4)`,
    [id, userId, 'A'.repeat(40), 'A'.repeat(54) + '=='],
  );
  return id;
}

describe('spaces', () => {
  it('starts with a Personal space and remembers the selection per device', async () => {
    const user = await createUser();
    const first = await space.listSpaces(await user.session());
    expect(first.spaces.map((s) => s.name)).toEqual(['Personal']);
    const { id: work } = await space.createSpace(await user.session(), { name: '  Work  ', kind: 'work' });
    expect((await space.listSpaces(await user.session())).selectedId).toBe(work);

    const other = await secondDevice(user);
    // The other device has its own selection.
    expect((await space.listSpaces(await other())).selectedId).toBe(first.spaces[0].id);
    await space.selectSpace(await other(), work);
    expect((await space.listSpaces(await other())).selectedId).toBe(work);
  });

  it('shows a device-restricted space only on the chosen devices, enforced on every read', async () => {
    const user = await createUser();
    await space.listSpaces(await user.session());
    const laptop = await user.session();
    const phone = await secondDevice(user);
    const { id: work } = await space.createSpace(laptop, { name: 'Work', kind: 'work' });
    await space.updateSpace(laptop, work, { allDevices: false, deviceIds: [laptop.device_id] });

    expect((await space.listSpaces(await phone())).spaces.map((s) => s.name)).toEqual(['Personal']);
    await expect(space.listPins(await phone(), work)).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.selectSpace(await phone(), work)).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.updateSpace(await phone(), work, { allDevices: true })).rejects.toMatchObject({ code: 'not_found' });

    await space.updateSpace(laptop, work, { allDevices: true });
    expect((await space.listSpaces(await phone())).spaces.map((s) => s.name)).toEqual(['Personal', 'Work']);
  });

  it('rejects other people’s devices and empty device lists', async () => {
    const user = await createUser();
    const other = await createUser('Other');
    const s = await user.session();
    const { spaces } = await space.listSpaces(s);
    await expect(space.updateSpace(s, spaces[0].id, { allDevices: false, deviceIds: [(await other.session()).device_id] })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(space.updateSpace(s, spaces[0].id, { allDevices: false, deviceIds: [] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('pins and unpins Cloud items, hiding trashed ones', async () => {
    const user = await createUser();
    const { a } = await setUpVault(user);
    const s = await a.session();
    const { spaces } = await space.listSpaces(s);
    const fileId = await cloudFile(user.userId);
    await space.pinItem(s, spaces[0].id, { fileId });
    await space.pinItem(s, spaces[0].id, { fileId }); // idempotent
    const pins = await space.listPins(s, spaces[0].id);
    expect(pins.files).toHaveLength(1);
    await query(`update cloud_files set trashed_at = now() where id = $1`, [fileId]);
    expect((await space.listPins(s, spaces[0].id)).files).toHaveLength(0);
    await query(`update cloud_files set trashed_at = null where id = $1`, [fileId]);
    await space.unpin(s, spaces[0].id, (pins.files[0] as { pin_id: string }).pin_id);
    expect((await space.listPins(s, spaces[0].id)).files).toHaveLength(0);
  });

  it('isolates accounts: no reading, pinning into, or pinning from another person’s data', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceSpace = (await space.listSpaces(await alice.session())).spaces[0].id;
    const bobSpace = (await space.listSpaces(await bob.session())).spaces[0].id;
    const aliceFile = await cloudFile(alice.userId);
    await expect(space.listPins(await bob.session(), aliceSpace)).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.pinItem(await bob.session(), aliceSpace, { fileId: aliceFile })).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.pinItem(await bob.session(), bobSpace, { fileId: aliceFile })).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.deleteSpace(await bob.session(), aliceSpace)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps at least one space and is unavailable on shared devices', async () => {
    const user = await createUser();
    const s = await user.session();
    const { spaces } = await space.listSpaces(s);
    await expect(space.deleteSpace(s, spaces[0].id)).rejects.toMatchObject({ code: 'last_space' });
    const { id } = await space.createSpace(s, { name: 'Study', kind: 'study' });
    await space.deleteSpace(s, id);
    await expect(space.createSpace(s, { name: '', kind: 'work' })).rejects.toMatchObject({ code: 'invalid' });
    const kiosk = await createUser('Kiosk', { shared: true });
    await expect(space.listSpaces(await kiosk.session())).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('encrypted Space items', () => {
  it('stores bookmarks end-to-end encrypted and shows them only to browsers with vault access', async () => {
    const { createUser: mk } = await import('../helpers/fixtures');
    const { secondBrowser } = await import('../helpers/cloud');
    const v = await import('@/lib/vault/crypto');
    const user = await mk();
    const { a, vk, vaultId } = await setUpVault(user);
    const sid = (await space.listSpaces(await a.session())).spaces[0].id;
    const sk = await v.deriveSpaceKey(vk, vaultId);
    const itemId = randomUUID();
    const body = { title: 'Team wiki', url: 'https://wiki.example.com/start' };
    await space.createSpaceItem(await a.session(), sid, { id: itemId, kind: 'bookmark', encryptedBody: await v.sealJson(sk, 'space-item', itemId, body), keyVersion: 1 });

    // Nothing readable is stored.
    const [row] = await query<{ encrypted_body: string }>(`select encrypted_body from space_items where id = $1`, [itemId]);
    expect(row.encrypted_body).not.toContain('wiki');
    const listed = await space.listSpaceItems(await a.session(), sid);
    expect(await v.openJson(sk, 'space-item', itemId, listed.items[0].encrypted_body)).toEqual(body);

    // A signed-in browser without vault access gets a count, not the items, and can't write.
    const b = await secondBrowser(user);
    expect(await space.listSpaceItems(await b.session(), sid)).toMatchObject({ items: [], locked: true, lockedCount: 1 });
    await expect(
      space.createSpaceItem(await b.session(), sid, { id: randomUUID(), kind: 'bookmark', encryptedBody: 'A'.repeat(40), keyVersion: 1 }),
    ).rejects.toMatchObject({ code: 'vault_locked' });
    await expect(space.deleteSpaceItem(await b.session(), sid, itemId)).rejects.toMatchObject({ code: 'vault_locked' });
  });

  it('refuses a stale edit from another browser instead of overwriting it', async () => {
    const { createUser: mk } = await import('../helpers/fixtures');
    const v = await import('@/lib/vault/crypto');
    const user = await mk();
    const { a, vk, vaultId } = await setUpVault(user);
    const sid = (await space.listSpaces(await a.session())).spaces[0].id;
    const sk = await v.deriveSpaceKey(vk, vaultId);
    const id = randomUUID();
    const seal = (title: string) => v.sealJson(sk, 'space-item', id, { label: title, url: 'https://example.com' });
    await space.createSpaceItem(await a.session(), sid, { id, kind: 'shortcut', encryptedBody: await seal('One'), keyVersion: 1 });
    // Two browsers both loaded version 1; the first save wins, the second is told to reload.
    await space.updateSpaceItem(await a.session(), sid, id, { encryptedBody: await seal('Two'), version: 1, keyVersion: 1 });
    await expect(space.updateSpaceItem(await a.session(), sid, id, { encryptedBody: await seal('Three'), version: 1, keyVersion: 1 })).rejects.toMatchObject({
      code: 'conflict',
    });
    const latest = (await space.listSpaceItems(await a.session(), sid)).items[0];
    expect(latest.version).toBe(2);
    expect(await v.openJson(sk, 'space-item', id, latest.encrypted_body)).toMatchObject({ label: 'Two' });
    // Stale key version is refused too.
    await expect(space.updateSpaceItem(await a.session(), sid, id, { encryptedBody: await seal('Four'), version: 2, keyVersion: 7 })).rejects.toMatchObject({
      code: 'stale_key',
    });
  });

  it('isolates items between accounts and respects device-restricted spaces', async () => {
    const { createUser: mk } = await import('../helpers/fixtures');
    const v = await import('@/lib/vault/crypto');
    const alice = await mk('Alice');
    const bob = await mk('Bob');
    const A = await setUpVault(alice);
    const B = await setUpVault(bob);
    const aliceSpace = (await space.listSpaces(await A.a.session())).spaces[0].id;
    const id = randomUUID();
    await space.createSpaceItem(await A.a.session(), aliceSpace, {
      id,
      kind: 'bookmark',
      encryptedBody: await v.sealJson(await v.deriveSpaceKey(A.vk, A.vaultId), 'space-item', id, { title: 'x', url: 'https://x.example' }),
      keyVersion: 1,
    });
    await expect(space.listSpaceItems(await B.a.session(), aliceSpace)).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.updateSpaceItem(await B.a.session(), aliceSpace, id, { position: 3, version: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(space.deleteSpaceItem(await B.a.session(), aliceSpace, id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await query(`select 1 from space_items where id = $1`, [id])).toHaveLength(1);
  });

  it('validates preferences', async () => {
    const { createUser: mk } = await import('../helpers/fixtures');
    const user = await mk();
    const s = await user.session();
    const sid = (await space.listSpaces(s)).spaces[0].id;
    await space.updateSpace(s, sid, { prefs: { cloudSort: 'updated', linksInNewTab: true, injected: 'x' } });
    expect((await space.listSpaces(s)).spaces[0].prefs).toEqual({ cloudSort: 'updated', linksInNewTab: true });
    await expect(space.updateSpace(s, sid, { prefs: { cloudSort: 'drop table' } })).rejects.toMatchObject({ code: 'invalid' });
  });
});

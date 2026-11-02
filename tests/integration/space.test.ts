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

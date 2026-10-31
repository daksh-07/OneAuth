import { describe, expect, it } from 'vitest';
import * as runtime from '@/lib/server/db';
import { query as admin } from '../helpers/admin';
import { createUser } from '../helpers/fixtures';

/**
 * These run through the application's own connection (the least-privilege
 * `oneauth_app` role) and check what PostgreSQL itself enforces, independent
 * of the application's WHERE clauses.
 */
const TENANT_TABLES = ['users', 'user_profiles', 'subscriptions', 'authenticators', 'devices', 'sessions', 'security_events'];

describe('runtime database role', () => {
  it('is a non-owner, non-superuser role without BYPASSRLS', async () => {
    const [r] = await runtime.query<{ role: string; rolsuper: boolean; rolbypassrls: boolean; owns: number }>(
      `select current_user as role, r.rolsuper, r.rolbypassrls,
              (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relowner = r.oid) as owns
         from pg_roles r where r.rolname = current_user`,
    );
    expect(r).toEqual({ role: 'oneauth_app', rolsuper: false, rolbypassrls: false, owns: 0 });
  });

  it('cannot run DDL, truncate, read migration history or delete audit events', async () => {
    await expect(runtime.query('create table evil (id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('truncate users')).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('select * from schema_migrations')).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('drop table sessions')).rejects.toMatchObject({ code: '42501' });
    const alice = await createUser('Alice');
    await expect(runtime.asUser(alice.userId, () => runtime.query('delete from security_events'))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('row-level security', () => {
  it('shows nothing from tenant tables outside a tenant scope', async () => {
    await createUser('Alice');
    await createUser('Bob');
    for (const t of TENANT_TABLES) {
      expect(await runtime.query(`select 1 from ${t}`), t).toHaveLength(0);
    }
  });

  it('shows each tenant only its own rows in every table', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    for (const user of [alice, bob]) {
      await runtime.asUser(user.userId, async () => {
        for (const t of TENANT_TABLES) {
          const col = t === 'users' ? 'id' : 'user_id';
          const rows = await runtime.query<{ owner: string }>(`select ${col}::text as owner from ${t}`);
          expect(rows.length, t).toBeGreaterThan(0);
          expect(new Set(rows.map((r) => r.owner)), t).toEqual(new Set([user.userId]));
        }
      });
    }
  });

  it('refuses cross-tenant writes even when the SQL targets the other user directly', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const [bobDevice] = await admin<{ id: string }>(`select id from devices where user_id = $1`, [bob.userId]);
    await runtime.asUser(alice.userId, async () => {
      // Invisible rows: updates and deletes match nothing.
      expect(await runtime.query(`update devices set name = 'pwned' where id = $1 returning id`, [bobDevice.id])).toHaveLength(0);
      expect(await runtime.query(`update users set display_name = 'pwned' where id = $1 returning id`, [bob.userId])).toHaveLength(0);
      expect(await runtime.query(`delete from sessions where user_id = $1 returning id`, [bob.userId])).toHaveLength(0);
    });
    // Inserting a row for another tenant violates the policy's WITH CHECK.
    await expect(
      runtime.asUser(alice.userId, () =>
        runtime.query(`insert into security_events (user_id, type) values ($1, 'auth.signin')`, [bob.userId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.asUser(alice.userId, () => runtime.query(`update devices set user_id = $1 where user_id = $2`, [bob.userId, alice.userId])),
    ).rejects.toMatchObject({ code: '42501' });
    const [stillBob] = await admin<{ name: string; user_id: string }>(`select name, user_id from devices where id = $1`, [bobDevice.id]);
    expect(stillBob.user_id).toBe(bob.userId);
    expect(stillBob.name).not.toBe('pwned');
  });

  it('pre-auth resolvers reveal only an owner ID for a known secret', async () => {
    expect(await runtime.one(`select oneauth_resolve_session($1) as uid`, [Buffer.alloc(32)])).toEqual({ uid: null });
    expect(await runtime.one(`select oneauth_resolve_credential('nope') as uid`)).toEqual({ uid: null });
  });
});

describe('tenant context on pooled connections', () => {
  it('never survives the transaction (commit or rollback)', async () => {
    const alice = await createUser('Alice');
    await runtime.asUser(alice.userId, async () => {
      expect(await runtime.one(`select current_setting('oneauth.user_id', true) as v`)).toEqual({ v: alice.userId });
    });
    await expect(
      runtime.asUser(alice.userId, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Many follow-up queries, likely on the same pooled connections: no context, no rows.
    for (let i = 0; i < 10; i++) {
      const row = await runtime.one<{ v: string | null }>(`select nullif(current_setting('oneauth.user_id', true), '') as v`);
      expect(row?.v ?? null).toBeNull();
      expect(await runtime.query(`select 1 from users`)).toHaveLength(0);
    }
  });

  it('keeps concurrent tenants isolated', async () => {
    const users = await Promise.all(['A', 'B', 'C', 'D'].map((n) => createUser(n)));
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) => users[i % users.length]).map((u) =>
        runtime.asUser(u.userId, async () => {
          const rows = await runtime.query<{ id: string }>(`select id::text from users`);
          const ctx = await runtime.one<{ v: string }>(`select current_setting('oneauth.user_id', true) as v`);
          return { expected: u.userId, seen: rows.map((r) => r.id), ctx: ctx?.v };
        }),
      ),
    );
    for (const r of results) {
      expect(r.seen).toEqual([r.expected]);
      expect(r.ctx).toBe(r.expected);
    }
  });

  it('refuses to nest a different tenant inside an open scope', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await expect(runtime.asUser(alice.userId, () => runtime.asUser(bob.userId, async () => 1))).rejects.toThrow('Tenant context mismatch');
  });
});

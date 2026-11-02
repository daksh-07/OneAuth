import { describe, expect, it } from 'vitest';
import { parseOrigins } from '@/lib/origins';
import { pgConfig } from '@/lib/server/db';
// @ts-expect-error — plain ESM helper shared with the migration runner
import { pgConfig as scriptPgConfig } from '../../scripts/pg-config.mjs';

describe('parseOrigins', () => {
  it('accepts bare https origins and local http', () => {
    expect(parseOrigins('https://a.example, http://localhost:3000,https://b.example/')).toEqual([
      'https://a.example',
      'http://localhost:3000',
      'https://b.example',
    ]);
  });
  it('rejects anything that is not a bare trustworthy origin', () => {
    expect(
      parseOrigins('http://a.example,https://a.example/path,https://user:pw@a.example,*,https://*.vercel.app,javascript:alert(1),'),
    ).toEqual([]);
  });
  it('is empty when unset', () => {
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe('pgConfig', () => {
  for (const [name, fn] of [['app', pgConfig], ['migrations', scriptPgConfig]] as const) {
    it(`${name}: verifies TLS for remote hosts even if the URL asks for less`, () => {
      const c = fn('postgres://u:p@db.example.com:6543/postgres?sslmode=no-verify&application_name=x', undefined);
      expect(c.ssl).toEqual({ rejectUnauthorized: true });
      expect(c.connectionString).not.toContain('sslmode');
      expect(c.connectionString).toContain('application_name=x');
    });
    it(`${name}: passes a custom CA through`, () => {
      expect(fn('postgres://u:p@db.example.com/postgres', 'PEM').ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
    });
    it(`${name}: leaves local connections unencrypted`, () => {
      expect(fn('postgres://u:p@localhost:5432/x', undefined).ssl).toBeUndefined();
    });
  }
});

describe('rpIdFor', () => {
  it('defaults to the origin hostname', async () => {
    const { rpIdFor } = await import('@/lib/server/env');
    delete process.env.ONEAUTH_RP_ID;
    expect(rpIdFor('https://app.oneauth.example')).toBe('app.oneauth.example');
  });
  it('uses a configured parent domain and rejects unrelated hosts', async () => {
    const { rpIdFor } = await import('@/lib/server/env');
    process.env.ONEAUTH_RP_ID = 'oneauth.example';
    try {
      expect(rpIdFor('https://app.oneauth.example')).toBe('oneauth.example');
      expect(rpIdFor('https://oneauth.example')).toBe('oneauth.example');
      expect(() => rpIdFor('https://oneauth.example.evil.com')).toThrow();
      expect(() => rpIdFor('https://notoneauth.example')).toThrow();
    } finally {
      delete process.env.ONEAUTH_RP_ID;
    }
  });
});

describe('derived app-role password', () => {
  it('is identical in the runtime and the build scripts, and depends on the owner password', async () => {
    const { appRolePassword } = await import('@/lib/server/env');
    // @ts-expect-error — plain ESM helper
    const scripts = await import('../../scripts/pg-config.mjs');
    const saved = { ...process.env };
    delete process.env.ONEAUTH_DB_APP_PASSWORD;
    process.env.ONEAUTH_DB_APP_ROLE = 'derived';
    try {
      const a = appRolePassword('postgres://owner:s3cr%40t@db.example/x');
      expect(a).toBe(scripts.appRolePassword('postgres://owner:s3cr%40t@db.example/x'));
      expect(a).toHaveLength(43);
      expect(a).not.toContain('s3cr');
      expect(appRolePassword('postgres://owner:other@db.example/x')).not.toBe(a);
      delete process.env.ONEAUTH_DB_APP_ROLE;
      expect(appRolePassword('postgres://owner:s3cr%40t@db.example/x')).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

describe('hosted runtime connection', () => {
  it('fails closed without an app credential and refuses an owner URL', async () => {
    const { runtimeDatabaseUrl } = await import('@/lib/server/env');
    const saved = { ...process.env };
    try {
      process.env.VERCEL = '1';
      process.env.DATABASE_URL = 'postgres://owner:secret@db.example/x';
      delete process.env.ONEAUTH_DB_APP_PASSWORD;
      delete process.env.ONEAUTH_DB_APP_ROLE;
      delete process.env.ONEAUTH_RUNTIME_DATABASE_URL;
      expect(runtimeDatabaseUrl()).toBeUndefined();
      process.env.ONEAUTH_RUNTIME_DATABASE_URL = process.env.DATABASE_URL;
      expect(runtimeDatabaseUrl()).toBeUndefined();
      process.env.ONEAUTH_RUNTIME_DATABASE_URL = 'postgres://oneauth_app:secret@db.example/x';
      expect(runtimeDatabaseUrl()).toBe(process.env.ONEAUTH_RUNTIME_DATABASE_URL);
    } finally {
      process.env = saved;
    }
  });
});

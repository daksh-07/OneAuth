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

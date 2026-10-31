import { describe, expect, it } from 'vitest';
import { normalizeUserCode, userCode } from '@/lib/server/tokens';
import { safeNext } from '@/lib/safe-next';
import { describeUserAgent } from '@/lib/ua';
import { ALL_SCOPES, GRANTABLE_SCOPES, DEFAULT_SCOPES, hasScope } from '@/lib/scopes';

describe('pairing codes', () => {
  it('generates unambiguous codes that round-trip through normalisation', () => {
    for (let i = 0; i < 200; i++) {
      const c = userCode();
      expect(c).toMatch(/^[346789ABCDEFGHJKMNPQRTWXY]{4}-[346789ABCDEFGHJKMNPQRTWXY]{4}$/);
      expect(normalizeUserCode(c.toLowerCase().replace('-', ' '))).toBe(c);
    }
  });
  it('rejects malformed or ambiguous input', () => {
    expect(normalizeUserCode('ABC')).toBeNull();
    expect(normalizeUserCode('O0O0-1I1I')).toBeNull();
    expect(normalizeUserCode('ABCD-EFGHJ')).toBeNull();
  });
});

describe('safeNext', () => {
  it.each([
    ['/devices', '/devices'],
    ['/pair/abc?x=1', '/pair/abc?x=1'],
    ['//evil.example', '/home'],
    ['/\\evil.example', '/home'],
    ['https://evil.example', '/home'],
    ['javascript:alert(1)', '/home'],
    [undefined, '/home'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'ios', 'Safari on iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'windows', 'Edge on Windows PC'],
    ['Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'android', 'Chrome on Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0', 'macos', 'Firefox on Mac'],
    [null, 'unknown', 'Browser on Device'],
  ])('%s', (ua, platform, name) => {
    expect(describeUserAgent(ua)).toEqual({ platform, name });
  });
});

describe('scope model', () => {
  it('never makes security:manage grantable to a paired device', () => {
    expect(GRANTABLE_SCOPES.owned).not.toContain('security:manage');
    expect(GRANTABLE_SCOPES.shared).not.toContain('security:manage');
  });
  it('keeps shared devices to read-only basics', () => {
    expect(GRANTABLE_SCOPES.shared.every((s) => s.endsWith(':read'))).toBe(true);
    expect(DEFAULT_SCOPES.shared).toEqual(['profile:read']);
  });
  it('defaults are always grantable', () => {
    for (const k of ['owned', 'shared'] as const) expect(DEFAULT_SCOPES[k].every((s) => GRANTABLE_SCOPES[k].includes(s))).toBe(true);
    expect(hasScope(ALL_SCOPES, 'security:manage')).toBe(true);
  });
});

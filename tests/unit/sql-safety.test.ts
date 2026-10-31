import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * The database role used at runtime owns the tables and has BYPASSRLS (Neon's
 * neondb_owner), so tenant isolation is enforced by the application. That only
 * holds if no SQL is ever built by string interpolation. Fail on any template
 * literal passed to a query helper that contains `${`.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
  });
}

it('never interpolates values into SQL text', () => {
  const root = path.join(import.meta.dirname, '../..');
  const offenders: string[] = [];
  for (const f of [...files(path.join(root, 'lib')), ...files(path.join(root, 'app'))]) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:query|one|\.query)(?:<[^>()]*>)?\(\s*`([^`]*)`/g)) {
      if (m[1].includes('${')) offenders.push(`${path.relative(root, f)}: ${m[1].slice(0, 60)}`);
    }
  }
  expect(offenders).toEqual([]);
});

/** Edge-safe copy of origin parsing for proxy.ts (which must not import server-only modules). */
export function parseOrigins(value: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const trimmed = raw.trim().replace(/\/$/, '');
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed);
      // Literal hostnames only: no wildcards or other non-DNS characters.
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(u.hostname)) continue;
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if ((u.protocol === 'https:' || (local && u.protocol === 'http:')) && u.origin === trimmed) out.push(u.origin);
    } catch {
      // Ignore malformed entries rather than trusting them.
    }
  }
  return out;
}

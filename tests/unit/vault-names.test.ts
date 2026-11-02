import { describe, expect, it } from 'vitest';
import { downloadType, safeName, safeUrl } from '@/lib/vault/names';

describe('decrypted names are untrusted', () => {
  it('strips bidi overrides, zero-width and control characters', () => {
    expect(safeName('invoice‮txt.exe')).toBe('invoicetxt.exe');
    expect(safeName('a​b\u0000c⁦d')).toBe('abcd');
    expect(safeName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeName('..')).toBe('Untitled');
    expect(safeName(42)).toBe('Untitled');
    expect(safeName('x'.repeat(500))).toHaveLength(200);
  });

  it('never gives a downloaded Blob an active content type', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/pdf', undefined]) {
      expect(downloadType(t)).toBe('application/octet-stream');
    }
  });

  it('only allows http(s) links without embedded credentials', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://intranet.local/')).toBe('http://intranet.local/');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', 'https://user:pw@example.com', 'not a url', '', null]) {
      expect(safeUrl(bad)).toBeNull();
    }
  });
});

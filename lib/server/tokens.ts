import 'server-only';
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** 256-bit random token, base64url encoded. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// Excludes 0/O, 1/I/L, 5/S, 2/Z, U/V to keep codes readable aloud and on low-DPI screens.
const CODE_ALPHABET = '346789ABCDEFGHJKMNPQRTWXY';

/** Human-readable pairing code, e.g. "K7Q-4MPX" (8 chars ≈ 37 bits). */
export function userCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeUserCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (cleaned.length !== 8) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

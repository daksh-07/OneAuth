/**
 * Defensive handling of decrypted, user-controlled strings. Anything that
 * decrypts correctly was written by one of the user's own devices, but that
 * device may be compromised, so names and types are treated as untrusted.
 */

// Bidirectional overrides/isolates, zero-width characters and C0/C1 controls:
// used to disguise extensions ("invoice‮txt.exe" displays as "invoiceexe.txt").
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** A file or folder name safe to display and to use as a download filename. */
export function safeName(name: unknown, fallback = 'Untitled'): string {
  if (typeof name !== 'string') return fallback;
  const clean = name.replace(UNSAFE, '').replace(/[/\\]/g, '_').trim().slice(0, 200);
  return clean && clean !== '.' && clean !== '..' ? clean : fallback;
}

/**
 * Content type for a downloaded Blob. Always opaque bytes: if a browser opens
 * a blob URL instead of saving it (some mobile browsers do), a type such as
 * text/html or image/svg+xml would run as a page on OneAuth's origin.
 */
export function downloadType(declared?: unknown): string {
  void declared; // deliberately ignored: the declared type comes from decrypted, untrusted metadata
  return 'application/octet-stream';
}

/** Only http(s) links are ever rendered; javascript:, data: and the like are refused. */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null; // no credentials in shared links
    return u.toString();
  } catch {
    return null;
  }
}

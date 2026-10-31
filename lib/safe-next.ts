/** Only same-site relative paths are accepted as post-sign-in destinations. */
export function safeNext(value: string | undefined | null, fallback = '/home'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.includes('\n')) return fallback;
  return value;
}

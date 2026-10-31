/** Coarse, privacy-preserving device description from a User-Agent string. */
export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'chromeos' | 'unknown';

export function describeUserAgent(ua: string | null | undefined): { platform: Platform; name: string } {
  const s = ua ?? '';
  let platform: Platform = 'unknown';
  if (/iPhone|iPad|iPod/.test(s)) platform = 'ios';
  else if (/Android/.test(s)) platform = 'android';
  else if (/CrOS/.test(s)) platform = 'chromeos';
  else if (/Mac OS X|Macintosh/.test(s)) platform = 'macos';
  else if (/Windows/.test(s)) platform = 'windows';
  else if (/Linux/.test(s)) platform = 'linux';

  let browser = 'Browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s) || /CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  const device: Record<Platform, string> = {
    ios: /iPad/.test(s) ? 'iPad' : 'iPhone',
    android: 'Android',
    macos: 'Mac',
    windows: 'Windows PC',
    linux: 'Linux',
    chromeos: 'Chromebook',
    unknown: 'Device',
  };
  return { platform, name: `${browser} on ${device[platform]}` };
}

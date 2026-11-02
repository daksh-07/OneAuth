/**
 * Permission model. Every session carries an explicit scope list that the
 * server checks on each request; the UI only mirrors it.
 */

export const SCOPES = {
  'profile:read': {
    label: 'Your name and account basics',
    description: 'See who is signed in on this device.',
  },
  'devices:read': {
    label: 'Your device list',
    description: 'See which devices are connected to your OneAuth.',
  },
  'devices:manage': {
    label: 'Manage devices',
    description: 'Connect new devices and revoke existing ones.',
  },
  'security:read': {
    label: 'Security history',
    description: 'See sign-ins, approvals and revocations.',
  },
  'security:manage': {
    label: 'Passkeys and account settings',
    description: 'Add or remove passkeys, export or delete the account.',
  },
  'cloud:read': {
    label: 'Encrypted files (view)',
    description: 'Download and decrypt files on an approved vault device.',
  },
  'cloud:write': {
    label: 'Encrypted files (change)',
    description: 'Upload, rename, move and delete encrypted files.',
  },
  'space:read': {
    label: 'Your spaces',
    description: 'See your spaces and what’s pinned in them.',
  },
  'space:write': {
    label: 'Change your spaces',
    description: 'Create spaces, change their settings and pins.',
  },
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** Scopes a paired device may be granted. security:manage is never delegable. */
export const GRANTABLE_SCOPES: Record<'owned' | 'shared', Scope[]> = {
  owned: ['profile:read', 'devices:read', 'devices:manage', 'security:read'],
  shared: ['profile:read', 'devices:read'],
};

export const DEFAULT_SCOPES: Record<'owned' | 'shared', Scope[]> = {
  owned: ['profile:read', 'devices:read', 'security:read'],
  shared: ['profile:read'],
};

/** Allowed access durations, in seconds. */
export const GRANT_DURATIONS: Record<'owned' | 'shared', { seconds: number; label: string }[]> = {
  shared: [
    { seconds: 15 * 60, label: '15 minutes' },
    { seconds: 60 * 60, label: '1 hour' },
    { seconds: 8 * 60 * 60, label: '8 hours' },
    { seconds: 24 * 60 * 60, label: '24 hours' },
  ],
  owned: [
    { seconds: 7 * 24 * 60 * 60, label: '7 days' },
    { seconds: 30 * 24 * 60 * 60, label: '30 days' },
  ],
};

/** Capabilities that exist in the roadmap but are not available yet. Shown, never granted. */
export const FUTURE_CAPABILITIES = [
  { id: 'cloud:files', label: 'Encrypted files', note: 'Arrives with OneAuth Cloud' },
  { id: 'space:workspace', label: 'Workspace and bookmarks', note: 'Arrives with OneAuth Space' },
  { id: 'connect:services', label: 'Connected services', note: 'Requires supported integrations' },
] as const;

export function isScope(value: string): value is Scope {
  return value in SCOPES;
}

export function hasScope(scopes: readonly string[], scope: Scope): boolean {
  return scopes.includes(scope);
}

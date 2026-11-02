const LABELS: Record<string, string> = {
  'account.created': 'Account created',
  'account.deleted': 'Account deleted',
  'account.exported': 'Account data exported',
  'auth.signin': 'Signed in with a passkey',
  'auth.signin_failed': 'Failed sign-in attempt',
  'auth.signout': 'Signed out',
  'auth.stepup': 'Identity confirmed with a passkey',
  'passkey.added': 'Passkey added',
  'passkey.removed': 'Passkey removed',
  'passkey.renamed': 'Passkey renamed',
  'session.revoked': 'Session ended remotely',
  'device.enrolled': 'Device added',
  'device.revoked': 'Device disconnected',
  'device.renamed': 'Device renamed',
  'pairing.approved': 'Device connection approved',
  'pairing.rejected': 'Device connection declined',
  'pairing.claimed': 'New device connected',
};

export function eventLabel(type: string, detail?: Record<string, unknown>): string {
  if (type === 'pairing.rejected' && detail?.reason === 'code_mismatch') return 'Device connection cancelled: code didn’t match';
  return LABELS[type] ?? type;
}

export function eventTone(type: string, detail?: Record<string, unknown>): 'neutral' | 'warning' | 'danger' | 'success' {
  if (type === 'auth.signin_failed' || (type === 'pairing.rejected' && detail?.reason === 'code_mismatch')) return 'warning';
  if (type === 'device.revoked' || type === 'session.revoked' || type === 'passkey.removed') return 'danger';
  if (type === 'pairing.claimed' || type === 'passkey.added' || type === 'account.created') return 'success';
  return 'neutral';
}

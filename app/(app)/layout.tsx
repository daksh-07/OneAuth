import { AppShell } from '@/components/app/app-shell';
import { requirePageSession } from '@/lib/server/auth';
import { hasScope } from '@/lib/scopes';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  return (
    <AppShell
      displayName={session.display_name}
      deviceName={session.device_name}
      restricted={session.device_kind === 'shared'}
      canManageDevices={session.kind === 'primary' && session.device_kind === 'owned' && hasScope(session.scopes, 'devices:manage')}
      canSeeDevices={hasScope(session.scopes, 'devices:read')}
      expiresAt={session.expires_at.toISOString()}
    >
      {children}
    </AppShell>
  );
}

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { ActivityList } from '@/components/app/activity-list';
import { SignOutButton } from '@/components/app/sign-out-button';
import { requirePageSession } from '@/lib/server/auth';
import { getAccount, listPasskeys } from '@/lib/server/account';
import { listEvents } from '@/lib/server/events';
import { listActiveSessions } from '@/lib/server/sessions';
import { hasScope } from '@/lib/scopes';
import { buttonClass } from '@/components/ui/button';
import { ProfileForm } from './profile-form';
import { PasskeyList } from './passkey-list';
import { SessionList } from './session-list';
import { ThemePicker } from './theme-picker';
import { DeleteAccount } from './delete-account';

export const metadata: Metadata = { title: 'Account & Security' };

export default async function AccountPage() {
  const session = await requirePageSession();
  const canRead = hasScope(session.scopes, 'security:read');
  const canManage = hasScope(session.scopes, 'security:manage');
  const [account, passkeys, sessions, events] = await Promise.all([
    getAccount(session.user_id),
    canManage ? listPasskeys(session.user_id) : null,
    canRead ? listActiveSessions(session.user_id) : null,
    canRead ? listEvents(session.user_id, 40) : null,
  ]);
  const theme = (await cookies()).get('oa_theme')?.value ?? 'system';

  return (
    <>
      <PageHeader title="Account & Security" description="Your identity, passkeys, sessions and data." />
      <div className="space-y-6">
        {!canManage ? (
          <Notice tone="info" title="Limited access on this device">
            Passkeys, profile and account settings can only be changed from a device you signed in to with your passkey.
          </Notice>
        ) : null}

        {canManage && account ? (
          <Panel aria-labelledby="profile">
            <PanelHeader id="profile" title="Profile" />
            <div className="p-5">
              <ProfileForm name={account.display_name} />
            </div>
          </Panel>
        ) : null}

        {passkeys ? (
          <Panel aria-labelledby="passkeys" id="passkeys" className="scroll-mt-20">
            <PanelHeader
              id="passkeys-heading"
              title="Passkeys"
              description="Passkeys sign you in with Face ID, a fingerprint, your screen lock or a security key."
            />
            <PasskeyList
              passkeys={passkeys.map((p) => ({
                ...p,
                created_at: p.created_at.toISOString(),
                last_used_at: p.last_used_at?.toISOString() ?? null,
              }))}
            />
          </Panel>
        ) : null}

        {canManage ? (
          <Panel aria-labelledby="recovery">
            <PanelHeader id="recovery" title="Recovery" action={<Badge tone="warning">Not available yet</Badge>} />
            <div className="space-y-2 p-5 text-sm leading-relaxed text-muted">
              <p>
                OneAuth can’t yet restore access if you lose every passkey, and support staff have no override. Today, your protection
                is having more than one passkey.
              </p>
              <p>
                You have <strong className="font-medium text-fg tabular">{passkeys?.length ?? 0}</strong> passkey
                {passkeys?.length === 1 ? '' : 's'}
                {passkeys?.some((p) => p.backed_up) ? ', including at least one that syncs through your password manager.' : '.'}
              </p>
            </div>
          </Panel>
        ) : null}

        {sessions ? (
          <Panel aria-labelledby="sessions">
            <PanelHeader id="sessions" title="Active sessions" description="Where your OneAuth is currently signed in." />
            <SessionList
              currentId={session.id}
              canRevoke={canManage}
              sessions={sessions.map((s) => ({
                id: s.id,
                deviceName: s.device_name,
                kind: s.kind,
                lastSeen: s.last_seen_at.toISOString(),
                expiresAt: s.expires_at.toISOString(),
              }))}
            />
          </Panel>
        ) : null}

        <Panel aria-labelledby="appearance">
          <PanelHeader id="appearance" title="Appearance" />
          <div className="p-5">
            <ThemePicker current={theme} />
          </div>
        </Panel>

        {events ? (
          <Panel aria-labelledby="history-heading" id="history" className="scroll-mt-20">
            <PanelHeader id="history-heading" title="Security history" description="Sign-ins, approvals and changes, newest first." />
            <ActivityList events={events} />
          </Panel>
        ) : null}

        <Panel aria-labelledby="data">
          <PanelHeader id="data" title="Your data" />
          <div className="divide-y divide-line">
            {canManage ? (
              <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Export your data</p>
                  <p className="text-[13px] text-muted">Download everything OneAuth stores about you as JSON.</p>
                </div>
                <a href="/api/account/export" className={buttonClass('secondary', 'md')} download>
                  <Download />
                  Export
                </a>
              </div>
            ) : null}
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Sign out</p>
                <p className="text-[13px] text-muted">Ends this session on {session.device_name}.</p>
              </div>
              <SignOutButton />
            </div>
            {canManage ? <DeleteAccount /> : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

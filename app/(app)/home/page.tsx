import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Cloud, MonitorSmartphone, Plus, QrCode } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RelativeTime } from '@/components/ui/time';
import { DeviceIcon } from '@/components/app/device-icon';
import { ActivityList } from '@/components/app/activity-list';
import { requirePageSession } from '@/lib/server/auth';
import { listDevices } from '@/lib/server/devices';
import { listEvents } from '@/lib/server/events';
import { listPasskeys } from '@/lib/server/account';
import { listActiveSessions } from '@/lib/server/sessions';
import { hasScope } from '@/lib/scopes';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const session = await requirePageSession();
  const canDevices = hasScope(session.scopes, 'devices:read');
  const canSecurity = hasScope(session.scopes, 'security:read');
  const canManageSecurity = hasScope(session.scopes, 'security:manage');
  const canApprove = session.kind === 'primary' && session.device_kind === 'owned' && hasScope(session.scopes, 'devices:manage');

  const [devices, events, passkeys, sessions] = await Promise.all([
    canDevices ? listDevices(session.user_id) : null,
    canSecurity ? listEvents(session.user_id, 6) : null,
    canManageSecurity ? listPasskeys(session.user_id) : null,
    canSecurity ? listActiveSessions(session.user_id) : null,
  ]);
  const firstName = session.display_name.split(/\s+/)[0];
  const temporary = devices?.filter((d) => d.kind === 'shared').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">Signed in on {session.device_name}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">Welcome back, {firstName}</h1>
        </div>
        {canApprove ? (
          <ButtonLink href="/devices/connect" size="lg" className="max-sm:w-full lg:hidden">
            <Plus />
            Connect a device
          </ButtonLink>
        ) : null}
      </div>

      {passkeys && passkeys.length === 1 ? (
        <Notice
          tone="warning"
          title="You have only one passkey"
          action={
            <ButtonLink href="/account#passkeys" size="sm" variant="secondary">
              Add a backup passkey
            </ButtonLink>
          }
        >
          Account recovery isn’t available yet. If this passkey is lost and doesn’t sync to another device, you won’t be able to
          sign in again. A second passkey on another device or a security key protects you.
        </Notice>
      ) : null}

      {devices && devices.length === 1 && canApprove ? (
        <Panel className="overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent-text">
              <QrCode className="size-6" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-[17px] font-semibold">Connect your next device</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Open <span className="font-mono text-[13px] text-fg">/connect</span> on a laptop or tablet, then approve it from
                here. You choose what it can see and how long it stays connected.
              </p>
            </div>
            <ButtonLink href="/devices/connect" variant="secondary">
              How it works
              <ArrowRight />
            </ButtonLink>
          </div>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
        {devices ? (
          <Panel aria-labelledby="home-devices">
            <PanelHeader
              id="home-devices"
              title="Connected devices"
              description={`${devices.length} connected${temporary ? ` · ${temporary} temporary` : ''}`}
              action={
                <Link href="/devices" className="text-[13px] font-medium text-accent-text hover:underline">
                  View all
                </Link>
              }
            />
            <ul className="divide-y divide-line">
              {devices.slice(0, 4).map((d) => (
                <li key={d.id}>
                  <Link href={`/devices/${d.id}`} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-sunken/50">
                    <span className="grid size-9 place-items-center rounded-[10px] bg-sunken [&_svg]:size-[18px]">
                      <DeviceIcon platform={d.platform} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        <span className="truncate">{d.name}</span>
                        {d.id === session.device_id ? <Badge tone="accent">This device</Badge> : null}
                      </p>
                      <p className="text-[12px] text-muted">
                        Last active <RelativeTime value={d.last_seen_at} />
                      </p>
                    </div>
                    <Badge tone={d.kind === 'owned' ? 'success' : 'warning'} dot>
                      {d.kind === 'owned' ? 'Owned' : 'Temporary'}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <Panel>
            <PanelHeader title="This device" description="Temporary access" />
            <div className="flex items-center gap-3.5 px-5 py-4">
              <MonitorSmartphone className="size-5 text-muted" aria-hidden="true" />
              <p className="text-sm">
                {session.device_name} · access ends <RelativeTime value={session.expires_at} />
              </p>
            </div>
          </Panel>
        )}

        <div className="space-y-6">
          {events ? (
            <Panel aria-labelledby="home-activity">
              <PanelHeader
                id="home-activity"
                title="Recent security activity"
                description={sessions ? `${sessions.length} active session${sessions.length === 1 ? '' : 's'}` : undefined}
                action={
                  <Link href="/account#history" className="text-[13px] font-medium text-accent-text hover:underline">
                    History
                  </Link>
                }
              />
              <ActivityList events={events} />
            </Panel>
          ) : null}

          <Panel>
            <div className="flex items-start gap-3.5 p-5">
              <Cloud className="mt-0.5 size-5 text-muted" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">OneAuth Cloud isn’t available yet</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Encrypted file storage launches once its encryption and recovery design has been reviewed.{' '}
                  <Link href="/cloud" className="text-accent-text underline underline-offset-2 hover:decoration-2">
                    Learn more
                  </Link>
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

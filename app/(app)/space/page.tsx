import type { Metadata } from 'next';
import { Bookmark, LayoutGrid, Link2, MonitorSmartphone, SlidersHorizontal } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { RelativeTime } from '@/components/ui/time';
import { requirePageSession } from '@/lib/server/auth';
import { hasScope, SCOPES } from '@/lib/scopes';
import { SpaceApp } from '@/components/space/space-app';
import { cloudEnabled } from '@/lib/server/cloud/access';

export const metadata: Metadata = { title: 'My Space' };

const PLANNED = [
  { icon: Bookmark, title: 'Bookmarks', body: 'A small set of links that follow you to any connected device.' },
  { icon: Link2, title: 'Service shortcuts', body: 'Quick links to supported services. OneAuth won’t sign in to them for you unless the service supports it.' },
  { icon: SlidersHorizontal, title: 'Preferences', body: 'Your OneAuth settings, applied when you open it on a new device.' },
];

export default async function SpacePage() {
  const session = await requirePageSession();
  const ownDevice = session.kind === 'primary' && session.device_kind === 'owned';
  if (ownDevice && !hasScope(session.scopes, 'space:read')) {
    return (
      <>
        <PageHeader title="My Space" description="Your portable workspace: the things you choose to carry between devices." />
        <Panel className="p-6">
          <p className="text-sm">This session started before spaces were available. Sign out and sign in again with your passkey to use them.</p>
        </Panel>
      </>
    );
  }
  if (ownDevice) {
    return (
      <>
        <PageHeader title="My Space" description="Your portable workspace: the things you choose to carry between devices." />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <SpaceApp userId={session.user_id} deviceId={session.device_id} cloudEnabled={cloudEnabled()} />
          <Panel className="self-start">
            <PanelHeader title="Coming to Space" action={<Badge tone="accent">Planned</Badge>} />
            <ul className="divide-y divide-line">
              {PLANNED.map((p) => (
                <li key={p.title} className="flex gap-3 px-5 py-3">
                  <p.icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{p.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="My Space" description="Your portable workspace: the things you choose to carry between devices." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel>
          <PanelHeader
            title="Spaces aren’t available on this device"
            description="Open OneAuth on one of your own devices, signed in with your passkey, to use your spaces. Here’s what’s planned."
            action={<Badge tone="accent">Planned</Badge>}
          />
          <ul className="grid gap-px bg-line sm:grid-cols-2">
            {PLANNED.map((p) => (
              <li key={p.title} className="bg-surface p-5">
                <p.icon className="size-5 text-muted" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">{p.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="self-start">
          <PanelHeader title="This device, today" />
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <MonitorSmartphone className="size-5 text-muted" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{session.device_name}</p>
                <p className="text-[12px] text-muted">
                  Access ends <RelativeTime value={session.expires_at} />
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 text-[13px] text-muted">
              {session.scopes.map((s) => (
                <li key={s}>· {SCOPES[s]?.label ?? s}</li>
              ))}
            </ul>
            {hasScope(session.scopes, 'devices:read') ? (
              <ButtonLink href="/devices" variant="secondary" size="sm" className="w-full">
                <LayoutGrid />
                Manage devices
              </ButtonLink>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

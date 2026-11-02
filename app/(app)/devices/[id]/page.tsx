import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RelativeTime } from '@/components/ui/time';
import { DeviceIcon } from '@/components/app/device-icon';
import { ActivityList } from '@/components/app/activity-list';
import { NoAccess } from '@/components/app/no-access';
import { RevokeDeviceButton } from '@/components/app/revoke-device-button';
import { requirePageSession } from '@/lib/server/auth';
import { getDevice } from '@/lib/server/devices';
import { listEvents } from '@/lib/server/events';
import { FUTURE_CAPABILITIES, hasScope, isScope, SCOPES } from '@/lib/scopes';
import { RenameDeviceForm } from './rename-form';

export const metadata: Metadata = { title: 'Device' };

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  if (!hasScope(session.scopes, 'devices:read')) return <NoAccess what="your device list" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const device = await getDevice(session.user_id, id);
  if (!device) notFound();
  const canManage = hasScope(session.scopes, 'devices:manage');
  const events = hasScope(session.scopes, 'security:read') ? await listEvents(session.user_id, 10, device.id) : null;
  const isCurrent = device.id === session.device_id;

  return (
    <div className="space-y-6">
      <Link href="/devices" className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-control px-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Devices
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-[16px] border border-line bg-surface shadow-low [&_svg]:size-6">
            <DeviceIcon platform={device.platform} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{device.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Badge tone={device.kind === 'owned' ? 'success' : 'warning'} dot>
                {device.kind === 'owned' ? 'Owned device' : 'Temporary access'}
              </Badge>
              {isCurrent ? <Badge tone="accent">This device</Badge> : null}
            </div>
          </div>
        </div>
        {canManage ? <RevokeDeviceButton deviceId={device.id} name={device.name} isCurrent={isCurrent} size="md" /> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Details" />
          <dl className="divide-y divide-line text-sm">
            <Row label="Connected">
              <RelativeTime value={device.created_at} />
            </Row>
            <Row label="Connected using">{device.enrolled_via === 'passkey' ? 'Passkey sign-in' : 'Approval from another device'}</Row>
            <Row label="Last active">
              <RelativeTime value={device.last_seen_at} />
            </Row>
            <Row label="Access ends">{device.access_expires_at ? <RelativeTime value={device.access_expires_at} /> : 'No active session'}</Row>
            <Row label="Active sessions">
              <span className="tabular">{device.active_sessions}</span>
            </Row>
          </dl>
          {canManage ? (
            <div className="border-t border-line p-5">
              <RenameDeviceForm deviceId={device.id} name={device.name} />
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader title="What this device can access" description="Enforced by OneAuth’s servers on every request." />
          <ul className="divide-y divide-line">
            {(device.scopes ?? []).filter(isScope).map((s) => (
              <li key={s} className="px-5 py-3">
                <p className="text-sm font-medium">{SCOPES[s].label}</p>
                <p className="text-[12px] text-muted">{SCOPES[s].description}</p>
              </li>
            ))}
            {(device.scopes ?? []).length === 0 ? <li className="px-5 py-4 text-sm text-muted">No active access.</li> : null}
            {FUTURE_CAPABILITIES.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-muted">
                <Lock className="size-4" aria-hidden="true" />
                <span className="flex-1 text-sm">{f.label}</span>
                <span className="text-[12px]">{f.note}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {events ? (
        <Panel>
          <PanelHeader title="Activity on this device" />
          {events.length ? <ActivityList events={events} /> : <p className="px-5 py-4 text-sm text-muted">No activity recorded.</p>}
        </Panel>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

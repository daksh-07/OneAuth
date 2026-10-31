import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, MonitorSmartphone, Plus } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Panel } from '@/components/ui/panel';
import { RelativeTime } from '@/components/ui/time';
import { DeviceIcon } from '@/components/app/device-icon';
import { NoAccess } from '@/components/app/no-access';
import { RevokeDeviceButton } from '@/components/app/revoke-device-button';
import { requirePageSession } from '@/lib/server/auth';
import { listDevices } from '@/lib/server/devices';
import { hasScope } from '@/lib/scopes';

export const metadata: Metadata = { title: 'Devices' };

export default async function DevicesPage() {
  const session = await requirePageSession();
  if (!hasScope(session.scopes, 'devices:read')) return <NoAccess what="your device list" />;
  const canManage = hasScope(session.scopes, 'devices:manage');
  const canApprove = canManage && session.kind === 'primary' && session.device_kind === 'owned';
  const devices = await listDevices(session.user_id);
  const owned = devices.filter((d) => d.kind === 'owned');
  const shared = devices.filter((d) => d.kind === 'shared');

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every device that can open your OneAuth, what it can see, and when its access ends."
        action={
          canApprove ? (
            <ButtonLink href="/devices/connect" className="max-sm:w-full">
              <Plus />
              Connect a device
            </ButtonLink>
          ) : null
        }
      />
      {devices.length === 0 ? (
        <Panel>
          <EmptyState icon={<MonitorSmartphone />} title="No connected devices" />
        </Panel>
      ) : (
        <div className="space-y-8">
          <DeviceGroup title="Your devices" devices={owned} currentId={session.device_id} canManage={canManage} />
          <DeviceGroup
            title="Temporary access"
            empty="No temporary devices. When you connect a shared device, it appears here until its access ends."
            devices={shared}
            currentId={session.device_id}
            canManage={canManage}
          />
        </div>
      )}
    </>
  );
}

function DeviceGroup({
  title,
  devices,
  currentId,
  canManage,
  empty,
}: {
  title: string;
  devices: Awaited<ReturnType<typeof listDevices>>;
  currentId: string;
  canManage: boolean;
  empty?: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-[13px] font-medium text-muted">
        {title} <span className="tabular">· {devices.length}</span>
      </h2>
      {devices.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-5 py-6 text-sm text-muted">{empty}</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
                <Link href={`/devices/${d.id}`} className="flex min-w-0 flex-1 items-center gap-3.5 rounded-control">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-sunken [&_svg]:size-5">
                    <DeviceIcon platform={d.platform} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      <span className="truncate">{d.name}</span>
                      {d.id === currentId ? <Badge tone="accent">This device</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      Active <RelativeTime value={d.last_seen_at} />
                      {d.access_expires_at ? (
                        <>
                          {' · '}access ends <RelativeTime value={d.access_expires_at} />
                        </>
                      ) : (
                        ' · no active session'
                      )}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-subtle sm:hidden" aria-hidden="true" />
                </Link>
                {canManage ? (
                  <div className="hidden sm:block">
                    <RevokeDeviceButton deviceId={d.id} name={d.name} isCurrent={d.id === currentId} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}

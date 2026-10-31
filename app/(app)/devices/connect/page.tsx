import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Laptop, ScanLine } from 'lucide-react';
import { Panel } from '@/components/ui/panel';
import { NoAccess } from '@/components/app/no-access';
import { requirePageSession } from '@/lib/server/auth';
import { hasScope } from '@/lib/scopes';
import { CodeEntry } from './code-entry';

export const metadata: Metadata = { title: 'Connect a device' };

export default async function ConnectDevicePage() {
  const session = await requirePageSession();
  if (!(session.kind === 'primary' && session.device_kind === 'owned' && hasScope(session.scopes, 'devices:manage'))) {
    return <NoAccess what="approving new devices" />;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/devices" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Devices
      </Link>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Connect a device</h1>
        <p className="mt-1.5 text-[15px] text-muted">Approve a laptop, tablet or shared computer from this device.</p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        <li>
          <Panel className="h-full p-5">
            <Laptop className="size-5 text-accent-text" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">On the new device</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Go to this site and choose <strong className="font-medium text-fg">Connect this device</strong>, or open{' '}
              <span className="font-mono text-fg">/connect</span>. A QR code and a code appear.
            </p>
          </Panel>
        </li>
        <li>
          <Panel className="h-full p-5">
            <ScanLine className="size-5 text-accent-text" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">On this device</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Scan the QR code with your camera, or type the code below. You’ll choose what it can access before anything is shared.
            </p>
          </Panel>
        </li>
      </ol>

      <Panel className="p-5 sm:p-6">
        <CodeEntry />
      </Panel>
    </div>
  );
}

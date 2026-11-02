import type { Metadata } from 'next';
import { CloudOff, FileLock2, KeyRound, LifeBuoy, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { requirePageSession } from '@/lib/server/auth';
import { getAccount } from '@/lib/server/account';
import { planById, PLANS, STORAGE_ADDON } from '@/lib/plans';
import { cloudEnabled } from '@/lib/server/cloud/access';
import { CloudApp } from '@/components/cloud/cloud-app';
import { NoAccess } from '@/components/app/no-access';

export const metadata: Metadata = { title: 'Cloud' };

function formatBytes(n: number) {
  if (n === 0) return 'None yet';
  return `${Math.round(n / 1024 ** 3)} GB`;
}

function formatPrice(p: { amount: number; currency: string } | null) {
  if (!p) return '—';
  return `${new Intl.NumberFormat('en-AU', { style: 'currency', currency: p.currency }).format(p.amount / 100)}/mo`;
}

export default async function CloudPage() {
  const session = await requirePageSession();
  if (cloudEnabled()) {
    if (session.kind !== 'primary' || session.device_kind !== 'owned') {
      return (
        <>
          <PageHeader title="Cloud" description="Encrypted personal storage, available on the devices you choose." />
          <NoAccess what="encrypted files" />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Cloud" description="Encrypted in your browser before upload. OneAuth stores only encrypted data." />
        <CloudApp userId={session.user_id} />
      </>
    );
  }
  const account = await getAccount(session.user_id);
  const plan = planById(account?.plan_id ?? 'free');

  return (
    <>
      <PageHeader title="Cloud" description="Encrypted personal storage, available on the devices you choose." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel>
          <div className="flex flex-col items-start gap-4 p-6 sm:p-8">
            <span className="grid size-12 place-items-center rounded-[14px] bg-sunken text-muted">
              <CloudOff className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-semibold">OneAuth Cloud isn’t available yet</h2>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
                We won’t store your files until we can encrypt them on your device in a way that’s been designed, implemented and
                independently reviewed, and until there’s a recovery process that doesn’t give anyone at OneAuth a way to read them.
              </p>
            </div>
          </div>
          <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
            <Pillar icon={<FileLock2 />} title="Encrypted on your device" body="Files are encrypted before upload with established, audited cryptography." />
            <Pillar icon={<KeyRound />} title="Keys stay with you" body="Each approved device gets its own key, and revoking the device revokes that key." />
            <Pillar icon={<LifeBuoy />} title="Recovery without a back door" body="Designed before launch, so losing a phone doesn’t mean losing your files." />
          </ul>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Your plan" />
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between px-5 py-3">
                <dt className="text-muted">Plan</dt>
                <dd className="font-medium">{plan.name}</dd>
              </div>
              <div className="flex justify-between px-5 py-3">
                <dt className="text-muted">Storage included</dt>
                <dd>{formatBytes(plan.storageBytes)}</dd>
              </div>
              <div className="flex justify-between px-5 py-3">
                <dt className="text-muted">Billing</dt>
                <dd>Not connected</dd>
              </div>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="Proposed plans" description="Not on sale. Prices are early estimates and may change." action={<Badge>Proposed</Badge>} />
            <ul className="divide-y divide-line text-sm">
              {PLANS.filter((p) => p.status === 'planned').map((p) => (
                <li key={p.id} className="flex justify-between px-5 py-3">
                  <span>
                    {p.name}
                    {p.storageBytes ? <span className="text-muted"> · {formatBytes(p.storageBytes)}</span> : null}
                  </span>
                  <span className="text-muted tabular">{p.proposedPrice ? formatPrice(p.proposedPrice) : 'TBC'}</span>
                </li>
              ))}
              <li className="flex justify-between px-5 py-3">
                <span>Extra 100 GB</span>
                <span className="text-muted tabular">{formatPrice(STORAGE_ADDON.proposedPrice)}</span>
              </li>
            </ul>
          </Panel>
          <p className="flex gap-2 px-1 text-[12px] leading-relaxed text-muted">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            No payment details are collected and nothing can be charged.
          </p>
        </div>
      </div>
    </>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="bg-surface p-5">
      <span className="text-accent-text [&_svg]:size-5">{icon}</span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
    </li>
  );
}

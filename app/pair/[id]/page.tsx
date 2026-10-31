import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { getSession } from '@/lib/server/auth';
import { requestContext } from '@/lib/server/request';
import { lookupPairingForApprover } from '@/lib/server/pairing';
import { UserFacingError } from '@/lib/server/errors';
import { normalizeUserCode } from '@/lib/server/tokens';
import { DEFAULT_SCOPES, FUTURE_CAPABILITIES, GRANT_DURATIONS, GRANTABLE_SCOPES, SCOPES } from '@/lib/scopes';
import { ApproveFlow } from './approve-flow';

export const metadata: Metadata = { title: 'Approve a device' };

export default async function PairPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const { id } = await params;
  const { code } = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/signin?next=${encodeURIComponent(`/pair/${id}`)}`);

  let req: Awaited<ReturnType<typeof lookupPairingForApprover>> = null;
  let forbidden = false;
  try {
    req = await lookupPairingForApprover(session, { id }, await requestContext());
  } catch (err) {
    if (!(err instanceof UserFacingError) || err.code !== 'forbidden') throw err;
    forbidden = true;
  }

  let content: React.ReactNode;
  if (forbidden) {
    content = (
      <Notice tone="warning" title="This device can’t approve new devices">
        To protect your account, only a device you signed in to with your passkey, and marked as your own, can approve new
        connections. Open this link on your phone instead.
      </Notice>
    );
  } else if (!req) {
    content = <Ended title="This request doesn’t exist" body="Check that you scanned the code on the device you’re connecting." />;
  } else if (req.status !== 'pending') {
    content = (
      <Ended
        title={req.status === 'expired' ? 'This request has expired' : 'This request was already handled'}
        body="Start again on the device you want to connect. Codes work once and expire after five minutes."
      />
    );
  } else {
    content = (
      <ApproveFlow
        request={{ ...req, createdAt: req.createdAt.toISOString(), expiresAt: req.expiresAt.toISOString() }}
        typedCode={code ? normalizeUserCode(code) : null}
        config={{
          scopes: Object.fromEntries(Object.entries(SCOPES).map(([k, v]) => [k, v.label])),
          grantable: GRANTABLE_SCOPES,
          defaults: DEFAULT_SCOPES,
          durations: GRANT_DURATIONS,
          future: FUTURE_CAPABILITIES.map((f) => ({ label: f.label, note: f.note })),
        }}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-xl items-center px-4">
        <Link href="/home" aria-label="OneAuth home" className="rounded-control">
          <Wordmark />
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pb-16">
        {content}
      </main>
    </div>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-6 text-center shadow-low sm:p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <ButtonLink href="/devices" variant="secondary" className="mt-6">
        Go to Devices
      </ButtonLink>
    </div>
  );
}

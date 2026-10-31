import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { getSession } from '@/lib/server/auth';
import { isBackendConfigured } from '@/lib/server/env';
import { ConnectFlow } from './connect-flow';

export const metadata: Metadata = { title: 'Connect this device' };

export default async function ConnectPage() {
  const configured = isBackendConfigured();
  const session = configured ? await getSession() : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="OneAuth home" className="rounded-control">
          <Wordmark />
        </Link>
        <Link href="/signin" className="text-sm text-muted hover:text-fg">
          Sign in with a passkey instead
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[880px]">
          {!configured ? (
            <Notice tone="warning" title="Device connection isn’t available on this deployment" className="mx-auto max-w-md">
              This preview isn’t connected to a database, so pairing requests can’t be created.
            </Notice>
          ) : session ? (
            <div className="mx-auto max-w-md text-center">
              <h1 className="text-2xl font-semibold">This device is already connected</h1>
              <p className="mt-2 text-muted">
                You’re signed in as {session.display_name} on {session.device_name}.
              </p>
              <ButtonLink href="/home" className="mt-6">
                Open OneAuth
              </ButtonLink>
            </div>
          ) : (
            <ConnectFlow />
          )}
        </div>
      </main>
    </div>
  );
}

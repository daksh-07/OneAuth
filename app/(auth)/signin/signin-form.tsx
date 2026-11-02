'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fingerprint, QrCode } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SharedDeviceToggle } from '@/components/app/shared-device-toggle';
import { useWebAuthnSupport } from '@/components/app/passkey-support';
import { authenticatePasskey, isCancellation, passkeyErrorMessage } from '@/lib/client/api';

export function SigninForm({ configured, next }: { configured: boolean; next: string }) {
  const router = useRouter();
  const supported = useWebAuthnSupport();
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    setPending(true);
    try {
      await authenticatePasskey('/api/auth/login', { shared });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(isCancellation(err) ? 'Sign-in was cancelled.' : passkeyErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {!configured ? (
        <Notice tone="warning" title="Sign-in isn’t available on this deployment">
          This preview isn’t connected to a database yet.
        </Notice>
      ) : null}
      {supported === false ? (
        <Notice tone="warning" title="This browser doesn’t support passkeys">
          You can still connect this device using your phone.
        </Notice>
      ) : null}
      <SharedDeviceToggle checked={shared} onChange={setShared} />
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="w-full" onClick={signIn} loading={pending} disabled={!configured || supported === false}>
        {!pending ? <Fingerprint /> : null}
        Sign in with a passkey
      </Button>
      <p className="text-[13px] leading-relaxed text-muted">
        No passkey on this computer? Your browser can usually use the one on your phone: choose the option to use a phone or
        tablet when prompted.
      </p>
      <div className="flex items-center gap-3 text-[12px] text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <ButtonLink href="/connect" variant="secondary" size="lg" className="w-full">
        <QrCode />
        Use your phone to connect this device
      </ButtonLink>
      <p className="text-center text-sm text-muted">
        New to OneAuth?{' '}
        <Link href="/signup" className="font-medium text-accent-text underline underline-offset-2 hover:decoration-2">
          Create an identity
        </Link>
      </p>
    </div>
  );
}

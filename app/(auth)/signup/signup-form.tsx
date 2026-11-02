'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { SharedDeviceToggle } from '@/components/app/shared-device-toggle';
import { useWebAuthnSupport } from '@/components/app/passkey-support';
import { isCancellation, passkeyErrorMessage, registerPasskey } from '@/lib/client/api';

export function SignupForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const supported = useWebAuthnSupport();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setNameError('Enter the name you’d like to use.');
      return;
    }
    setNameError(null);
    setPending(true);
    try {
      await registerPasskey('/api/auth/register', { displayName: name }, { shared });
      router.replace('/welcome');
      router.refresh();
    } catch (err) {
      if (!isCancellation(err)) setError(passkeyErrorMessage(err));
      else setError('Passkey creation was cancelled. You can try again whenever you’re ready.');
      setPending(false);
    }
  }

  const disabled = !configured || supported === false;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {!configured ? (
        <Notice tone="warning" title="Sign-up isn’t available on this deployment">
          This preview isn’t connected to a database yet, so no account can be created. Nothing you enter is stored.
        </Notice>
      ) : null}
      {supported === false ? (
        <Notice tone="warning" title="This browser doesn’t support passkeys">
          Try a recent version of Safari, Chrome, Edge or Firefox.
        </Notice>
      ) : null}
      <Field label="Your name" hint="Shown on your devices and in your passkey manager." error={nameError}>
        {(p) => (
          <Input
            {...p}
            autoComplete="name"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Chen"
            disabled={disabled}
          />
        )}
      </Field>
      <SharedDeviceToggle checked={shared} onChange={setShared} />
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={disabled}>
        {!pending ? <Fingerprint /> : null}
        Create passkey
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/signin" className="font-medium text-accent-text underline underline-offset-2 hover:decoration-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Cloud, Compass, Fingerprint, MonitorSmartphone, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/cn';
import { setPrimaryUseAction } from '@/lib/server/actions';
import { isCancellation, passkeyErrorMessage, registerPasskey, withStepUp } from '@/lib/client/api';

const USES = [
  { id: 'devices', icon: MonitorSmartphone, title: 'Connect my devices', body: 'Approve laptops and tablets from my phone' },
  { id: 'temporary', icon: Timer, title: 'Manage temporary access', body: 'Use shared computers without leaving access behind' },
  { id: 'files', icon: Cloud, title: 'Access my files anywhere', body: 'Coming with OneAuth Cloud' },
  { id: 'explore', icon: Compass, title: 'Just exploring', body: 'Show me around' },
] as const;

export function WelcomeFlow({ name, passkeySynced }: { name: string; passkeySynced: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<'use' | 'protect'>('use');
  const [use, setUse] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  function continueFromUse() {
    if (!use) return;
    start(async () => {
      const res = await setPrimaryUseAction(use);
      if (!res.ok) return setMessage({ tone: 'error', text: res.message });
      setStep('protect');
    });
  }

  async function addBackup() {
    setAdding(true);
    setMessage(null);
    try {
      await withStepUp(() => registerPasskey('/api/auth/passkeys', {}, { nickname: 'Backup passkey' }));
      setMessage({ tone: 'success', text: 'Backup passkey added.' });
    } catch (err) {
      setMessage({ tone: 'error', text: isCancellation(err) ? 'Cancelled. You can add one later from Account & Security.' : passkeyErrorMessage(err) });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <p className="text-sm text-muted">Step {step === 'use' ? 1 : 2} of 2</p>
      {step === 'use' ? (
        <>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">You’re in, {name}.</h1>
          <p className="mt-2 text-[15px] text-muted">What would you like OneAuth to help with first?</p>
          <div className="mt-6 grid gap-2.5" role="radiogroup" aria-label="Primary use">
            {USES.map((u) => (
              <button
                key={u.id}
                type="button"
                role="radio"
                aria-checked={use === u.id}
                onClick={() => setUse(u.id)}
                className={cn(
                  'flex items-center gap-4 rounded-card border p-4 text-left transition-colors',
                  use === u.id ? 'border-accent bg-accent-soft ring-2 ring-accent/25' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <u.icon className="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium">{u.title}</span>
                  <span className="block text-[13px] text-muted">{u.body}</span>
                </span>
              </button>
            ))}
          </div>
          <Button size="lg" className="mt-6 w-full" onClick={continueFromUse} disabled={!use} loading={pending}>
            Continue
          </Button>
        </>
      ) : (
        <>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Protect your way back in</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {passkeySynced
              ? 'Your passkey is synced by your device’s password manager, so it should be available on your other devices signed in to the same account.'
              : 'Your passkey appears to be stored only on this device.'}{' '}
            A second passkey, on another device or a security key, means losing one doesn’t lock you out.
          </p>
          <Notice tone="warning" title="Account recovery isn’t available yet" className="mt-5">
            If every passkey is lost, OneAuth can’t restore access. That’s deliberate: there’s no staff override. A recovery process is
            being designed.
          </Notice>
          {message ? (
            <p className={cn('mt-4 text-sm', message.tone === 'success' ? 'text-success' : 'text-danger')} role="status">
              {message.text}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3">
            <Button size="lg" onClick={addBackup} loading={adding}>
              {!adding ? <Fingerprint /> : null}
              Add a backup passkey
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                router.replace('/home');
                router.refresh();
              }}
            >
              Go to my dashboard
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

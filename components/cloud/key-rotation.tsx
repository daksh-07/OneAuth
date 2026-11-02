'use client';

import { useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { ApiError, isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';
import { RecoveryKeyStep } from './recovery-key-step';

type Step = { kind: 'explain' } | { kind: 'recovery'; prepared: cloud.PreparedRotation } | { kind: 'running'; done: number; total: number };

/** What replacing the vault key does and doesn't do (docs/cloud/key-rotation.md §1). */
function WhatItDoes() {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-muted">
      <p>
        A new vault key is created in this browser and given to each browser that still has access. Your file keys, folder names and Space items are
        re-encrypted under it, and you get a new recovery key.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong className="text-fg">Protects:</strong> files you add from now on, against any browser you’ve removed.
        </li>
        <li>
          <strong className="text-fg">Doesn’t undo:</strong> anything a removed browser already downloaded or decrypted. Existing files keep their
          contents as they are; OneAuth already refuses to send them to removed browsers.
        </li>
      </ul>
    </div>
  );
}

export function RotateKeyDialog({
  open,
  state,
  vaultKey,
  reason,
  onClose,
  onDone,
}: {
  open: boolean;
  state: cloud.VaultState;
  vaultKey: Uint8Array;
  reason: 'device_removed' | 'manual';
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'explain' });
  const [error, setError] = useState<string | null>(null);
  const running = step.kind === 'running';

  async function run(prepared: cloud.PreparedRotation) {
    setError(null);
    try {
      const { rotationId } = await withStepUp(() => cloud.startRotation(prepared, state, reason));
      setStep({ kind: 'running', done: 0, total: 0 });
      await cloud.finishRotation(vaultKey, prepared.vaultKey, state.vault!.id, rotationId, (p) => setStep({ kind: 'running', ...p }));
      onDone();
    } catch (err) {
      if (isCancellation(err)) return;
      setStep({ kind: 'recovery', prepared });
      if (err instanceof ApiError && err.code === 'devices_changed') setError('Browsers were added or removed meanwhile. Close this and try again.');
      else setError(`${passkeyErrorMessage(err)} Any browser with access can finish or cancel the replacement from the Cloud page.`);
      onDone(); // refresh: an interrupted rotation shows as resumable
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent title="Replace your vault key" className="sm:max-w-lg">
        {step.kind === 'explain' ? (
          <>
            <WhatItDoes />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Not now
              </Button>
              <Button onClick={async () => setStep({ kind: 'recovery', prepared: await cloud.prepareRotation() })}>Continue</Button>
            </div>
          </>
        ) : step.kind === 'recovery' ? (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              Save your <strong className="text-fg">new</strong> recovery key. Your old one stops working once the replacement finishes. If it’s
              cancelled, the old key stays valid and this one won’t work.
            </p>
            <RecoveryKeyStep
              display={step.prepared.recovery.display}
              confirmLabel="Replace vault key"
              busy={false}
              error={error}
              onConfirm={() => run(step.prepared)}
              onCancel={onClose}
              note="You’ll be asked to confirm with your passkey. Keep this page open until it finishes."
            />
          </>
        ) : (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              Re-encrypting in this browser…
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${step.total ? (step.done / step.total) * 100 : 5}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-muted tabular">
              {step.done} of {step.total || '…'} items
            </p>
          </div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

/** Shown on every approved browser while a replacement is unfinished, so any of them can finish or cancel it. */
export function RotationInProgress({
  state,
  vaultKey,
  privateKey,
  onDone,
}: {
  state: cloud.VaultState;
  vaultKey: Uint8Array;
  privateKey: CryptoKey;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<'resume' | 'cancel' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setBusy('resume');
    setError(null);
    try {
      const next = await cloud.rotationNextKey(privateKey);
      if (!next) throw new Error('no key');
      await cloud.finishRotation(vaultKey, next.newKey, state.vault!.id, next.rotationId, setProgress);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This browser couldn’t finish the replacement. Try again, or cancel it.');
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    setError(null);
    try {
      await cloud.abortRotation(state.rotation!.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Notice
      tone="warning"
      title="A vault key replacement hasn’t finished"
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={resume} loading={busy === 'resume'} disabled={busy !== null}>
            <KeyRound />
            Finish it in this browser
          </Button>
          <Button size="sm" variant="secondary" onClick={cancel} loading={busy === 'cancel'} disabled={busy !== null}>
            Cancel replacement
          </Button>
        </div>
      }
    >
      Until it finishes, you can’t upload, create folders or approve browsers. Finishing it makes the new recovery key the only one that works;
      cancelling keeps the old one.
      {progress ? (
        <span className="mt-1 block tabular" aria-live="polite">
          {progress.done} of {progress.total} items re-encrypted
        </span>
      ) : null}
      {error ? <span className="mt-1 block text-danger">{error}</span> : null}
    </Notice>
  );
}

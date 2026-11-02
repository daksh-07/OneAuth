'use client';

import { useState } from 'react';
import { FileLock2, KeyRound, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';
import type { PublicDeviceJwk } from '@/lib/vault/crypto';
import { RecoveryKeyStep } from './recovery-key-step';

/** Creates the vault on this browser. The recovery key is shown once and must be confirmed before anything is sent. */
export function VaultSetup({ jwk, onCreated }: { jwk: PublicDeviceJwk; onCreated: () => void }) {
  const [prepared, setPrepared] = useState<cloud.PreparedVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  async function start() {
    setError(null);
    setPrepared(await cloud.prepareVault());
  }

  async function create() {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => cloud.createVault(prepared, jwk));
      onCreated();
    } catch (err) {
      if (!isCancellation(err)) setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!prepared) {
    return (
      <Panel>
        <div className="p-6 sm:p-8">
          <span className="grid size-12 place-items-center rounded-[14px] bg-accent-soft text-accent-text">
            <FileLock2 className="size-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Set up your encrypted vault</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            Files are encrypted in this browser before they’re uploaded. OneAuth stores only encrypted data and can’t open your files.
          </p>
          <ul className="mt-5 space-y-3 text-sm">
            <li className="flex gap-3">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
              This browser gets its own key. You approve each additional device from one you’ve already set up.
            </li>
            <li className="flex gap-3">
              <LifeBuoy className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
              You’ll get a recovery key. If you lose every approved device <strong>and</strong> the recovery key, your files can’t be recovered by anyone,
              including OneAuth.
            </li>
          </ul>
          <Button className="mt-6" onClick={start}>
            Create my vault
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Save your recovery key</h2>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
          This is the only time it will be shown. If you lose every approved browser, this key is the only way back into your files. Anyone with
          this key and access to your OneAuth account could unlock them.
        </p>
        <RecoveryKeyStep
          display={prepared.recovery.display}
          confirmLabel="Create vault"
          busy={busy}
          error={error}
          onConfirm={create}
          onCancel={() => setPrepared(null)}
          note="You’ll be asked to confirm with your passkey."
        />
      </div>
    </Panel>
  );
}

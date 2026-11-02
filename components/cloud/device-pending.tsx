'use client';

import { useState } from 'react';
import { Hourglass, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { Panel } from '@/components/ui/panel';
import { isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import { VaultCryptoError, type PublicDeviceJwk } from '@/lib/vault/crypto';
import * as cloud from '@/lib/vault/client';

/** Shown on a browser that has registered its key but hasn't been approved yet. */
export function DevicePending({
  fingerprint,
  jwk,
  userId,
  keyVersion,
  onUnlocked,
}: {
  fingerprint: string;
  jwk: PublicDeviceJwk;
  userId: string;
  keyVersion: number;
  onUnlocked: () => void;
}) {
  const [recovering, setRecovering] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => cloud.recoverWithKey(key, jwk, userId, keyVersion));
      onUnlocked();
    } catch (err) {
      if (err instanceof VaultCryptoError) setError(err.message);
      else if (!isCancellation(err)) setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-[14px] bg-warning-soft text-warning">
          <Hourglass className="size-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold">Approve this browser from another device</h2>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
          On a device that already has access, open Cloud. You’ll see a request from this browser. Approve it only if the security code there
          matches this one exactly.
        </p>
        <p className="mt-5 text-[13px] font-medium text-muted">Security code for this browser</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]" data-testid="device-fingerprint">
          {fingerprint}
        </p>
        <p className="mt-4 text-[13px] text-muted" aria-live="polite">
          Waiting for approval… this page updates automatically.
        </p>

        <div className="mt-8 border-t border-line pt-6">
          {!recovering ? (
            <Button variant="secondary" onClick={() => setRecovering(true)}>
              <LifeBuoy />
              Use my recovery key instead
            </Button>
          ) : (
            <form onSubmit={recover} className="max-w-lg">
              <label htmlFor="rk" className="text-sm font-medium">
                Recovery key
              </label>
              <Input
                id="rk"
                className="mt-1.5 font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <p className="mt-1.5 text-[13px] text-muted">Checked in this browser. The key itself is never sent to OneAuth.</p>
              {error ? (
                <Notice tone="danger" title="Couldn’t unlock with that key" className="mt-4">
                  {error}
                </Notice>
              ) : null}
              <div className="mt-4 flex gap-2">
                <Button type="submit" loading={busy} disabled={key.trim().length < 20}>
                  Unlock
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRecovering(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Panel>
  );
}

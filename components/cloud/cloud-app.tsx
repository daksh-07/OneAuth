'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/client/api';
import type { PublicDeviceJwk } from '@/lib/vault/crypto';
import * as cloud from '@/lib/vault/client';
import { DevicePending } from './device-pending';
import { FileBrowser } from './file-browser';
import { VaultDevices } from './vault-devices';
import { VaultSetup } from './vault-setup';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; signInAgain?: boolean }
  | { kind: 'setup' }
  | { kind: 'pending'; fingerprint: string }
  | { kind: 'removed' }
  | { kind: 'ready'; vaultKey: Uint8Array };

export function CloudApp({ userId, initialFolder = null }: { userId: string; initialFolder?: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [state, setState] = useState<cloud.VaultState | null>(null);
  const [device, setDevice] = useState<{ keys: CryptoKeyPair; jwk: PublicDeviceJwk } | null>(null);

  // Whether this browser had a vault record during this visit: if it disappears, access was declined or removed.
  const hadRecord = useRef(false);
  const deviceRef = useRef<{ keys: CryptoKeyPair; jwk: PublicDeviceJwk } | null>(null);

  const sync = useCallback(async (opts: { askAgain?: boolean } = {}) => {
    try {
      const dev = deviceRef.current ?? (await cloud.deviceKeys(userId));
      if (!deviceRef.current) {
        deviceRef.current = dev;
        setDevice(dev);
      }
      let s = await cloud.getState();
      if (!s.vault) {
        setState(s);
        return setPhase({ kind: 'setup' });
      }
      const mine = await cloud.fingerprintOf(dev.jwk);
      // No record for this browser's key yet (new browser, or its access was removed): ask for approval.
      if (!s.device || s.device.fingerprint !== mine) {
        if (hadRecord.current && !opts.askAgain) return setPhase({ kind: 'removed' });
        await cloud.registerDevice(dev.jwk);
        s = await cloud.getState();
      }
      setState(s);
      hadRecord.current = Boolean(s.device);
      if (s.device?.status === 'active') {
        const vaultKey = await cloud.unlock(s, dev.keys.privateKey);
        setPhase((p) => (p.kind === 'ready' ? p : { kind: 'ready', vaultKey }));
      } else {
        setPhase({ kind: 'pending', fingerprint: mine });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'forbidden') {
        setPhase({ kind: 'error', message: 'This session was started before Cloud was enabled. Sign out and sign in again with your passkey.', signInAgain: true });
      } else if (err instanceof ApiError) {
        setPhase({ kind: 'error', message: err.message });
      } else {
        setPhase({ kind: 'error', message: 'This browser couldn’t unlock your vault. Its stored key may have been cleared. Ask for approval again, or use your recovery key.' });
      }
    }
  }, [userId]);

  useEffect(() => {
    const t = setTimeout(() => void sync(), 0);
    return () => clearTimeout(t);
  }, [sync]);

  // While waiting for approval, check periodically; once ready, refresh pending requests occasionally.
  useEffect(() => {
    if (phase.kind !== 'pending' && phase.kind !== 'ready') return;
    const t = setInterval(() => void sync(), phase.kind === 'pending' ? 4000 : 15000);
    return () => clearInterval(t);
  }, [phase.kind, sync]);

  return (
    <div className="space-y-6">
      <Notice tone="warning" title="Developer preview: use test files only">
        Encryption happens in your browser, but the design hasn’t had an independent security review yet. Don’t upload real personal or sensitive
        files. Files are limited to 25 MB.
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Preview data may be deleted without notice.
        </span>
      </Notice>

      {phase.kind === 'loading' ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : phase.kind === 'error' ? (
        <Notice
          tone="danger"
          title="Cloud couldn’t start"
          action={
            phase.signInAgain ? null : (
              <Button size="sm" variant="secondary" onClick={() => void sync()}>
                Try again
              </Button>
            )
          }
        >
          {phase.message}
        </Notice>
      ) : phase.kind === 'removed' ? (
        <Notice
          tone="info"
          title="This browser doesn’t have access to your files"
          action={
            <Button size="sm" variant="secondary" onClick={() => void sync({ askAgain: true })}>
              Ask for access again
            </Button>
          }
        >
          The request was declined, or access was removed from another device.
        </Notice>
      ) : phase.kind === 'setup' && device ? (
        <VaultSetup jwk={device.jwk} onCreated={() => void sync()} />
      ) : phase.kind === 'pending' && device ? (
        <DevicePending fingerprint={phase.fingerprint} jwk={device.jwk} onUnlocked={() => void sync()} />
      ) : phase.kind === 'ready' && state?.vault ? (
        <div className="space-y-6">
          <FileBrowser initialFolder={initialFolder} vaultKey={phase.vaultKey} vaultId={state.vault.id} usage={state.usage} onUsageChange={() => void sync()} />
          <div className="grid gap-6 lg:ml-[224px] lg:grid-cols-2">
            <VaultDevices devices={state.devices} vaultKey={phase.vaultKey} onChange={() => void sync()} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

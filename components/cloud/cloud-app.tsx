'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, ShieldCheck } from 'lucide-react';
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
import { RotateKeyDialog, RotationInProgress } from './key-rotation';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; signInAgain?: boolean }
  | { kind: 'setup' }
  | { kind: 'pending'; fingerprint: string }
  | { kind: 'removed' }
  | { kind: 'ready'; vaultKey: Uint8Array; keyVersion: number };

export function CloudApp({ userId, initialFolder = null }: { userId: string; initialFolder?: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [state, setState] = useState<cloud.VaultState | null>(null);
  const [device, setDevice] = useState<{ keys: CryptoKeyPair; jwk: PublicDeviceJwk } | null>(null);
  const [rotate, setRotate] = useState<{ reason: 'device_removed' | 'manual' } | null>(null);
  const [removedName, setRemovedName] = useState<string | null>(null);

  // Whether this browser had a vault record during this visit: if it disappears, access was declined or removed.
  const hadRecord = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
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
        const keyVersion = s.vault!.key_version;
        // Unlock again whenever the vault key was replaced (by this or another browser):
        // a browser still holding the old key would otherwise write under it.
        const unlockNow = async () => ({ kind: 'ready' as const, vaultKey: await cloud.unlock(s, dev.keys.privateKey), keyVersion });
        const current = phaseRef.current;
        setPhase(current.kind === 'ready' && current.keyVersion === keyVersion ? current : await unlockNow());
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
        files. Files are limited to 25 MB each.
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Preview data may be deleted without notice.
        </span>
      </Notice>

      <details className="rounded-card border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-fg">
          <ShieldCheck className="size-4 text-accent-text" aria-hidden="true" />
          How your files are protected
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Each file is encrypted in this browser with its own key before any of it is uploaded. File and folder names are encrypted too.</li>
          <li>OneAuth stores only encrypted data. It sees sizes, dates and how many items you have, not names or contents.</li>
          <li>Only browsers you’ve approved, after comparing a security code, hold the key that opens your files.</li>
          <li>
            Limits: it relies on the code this site sends to your browser, and a browser you remove keeps anything it already downloaded. See the
            security design for details.
          </li>
        </ul>
      </details>

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
      ) : phase.kind === 'ready' && state?.vault && device ? (
        <div className="space-y-6">
          {state.rotation ? (
            <RotationInProgress state={state} vaultKey={phase.vaultKey} privateKey={device.keys.privateKey} onDone={() => void sync()} />
          ) : removedName ? (
            <Notice
              tone="info"
              title={`${removedName} can no longer open your files`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setRotate({ reason: 'device_removed' })}>
                    Replace vault key
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemovedName(null)}>
                    Not now
                  </Button>
                </div>
              }
            >
              OneAuth already refuses its requests. If it might be lost or compromised, also replace your vault key so it can’t open anything you add
              from now on.
            </Notice>
          ) : null}
          <FileBrowser
            initialFolder={initialFolder}
            vaultKey={phase.vaultKey}
            keyVersion={phase.keyVersion}
            vaultId={state.vault.id}
            usage={state.usage}
            readOnly={Boolean(state.rotation)}
            onUsageChange={() => void sync()}
          />
          <div className="grid gap-6 lg:ml-[224px] lg:grid-cols-2">
            <VaultDevices
              userId={userId}
              devices={state.devices}
              vaultKey={phase.vaultKey}
              keyVersion={phase.keyVersion}
              rotating={Boolean(state.rotation)}
              onChange={() => void sync()}
              onRemoved={(name) => {
                setRemovedName(name);
                void sync();
              }}
              onForgotten={() => {
                deviceRef.current = null;
                hadRecord.current = true;
                setPhase({ kind: 'removed' });
              }}
              onReplaceKey={() => setRotate({ reason: 'manual' })}
            />
          </div>
          {rotate ? (
            <RotateKeyDialog
              open
              state={state}
              vaultKey={phase.vaultKey}
              reason={rotate.reason}
              onClose={() => setRotate(null)}
              onDone={() => {
                setRotate(null);
                setRemovedName(null);
                void sync();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Copy, Download, FileLock2, KeyRound, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { Panel } from '@/components/ui/panel';
import { isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';
import type { PublicDeviceJwk } from '@/lib/vault/crypto';

/** Creates the vault on this browser. The recovery key is shown once and must be confirmed before anything is sent. */
export function VaultSetup({ jwk, onCreated }: { jwk: PublicDeviceJwk; onCreated: () => void }) {
  const [prepared, setPrepared] = useState<cloud.PreparedVault | null>(null);
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = prepared?.recovery.display.split('-') ?? [];
  const checkIndex = 4; // ask for the 5th group
  const checkOk = check.trim().toUpperCase() === groups[checkIndex];

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

  function downloadKey() {
    if (!prepared) return;
    const text =
      `OneAuth Cloud recovery key\n\n${prepared.recovery.display}\n\n` +
      `This key can unlock your encrypted files if you lose access to all of your approved devices.\n` +
      `OneAuth can't recover it for you. Keep it somewhere safe and private, such as a password manager or printed in a secure place.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oneauth-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyKey() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.recovery.display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying isn’t available here. Download the key or write it down instead.');
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
          This is the only time it will be shown. Store it somewhere private, such as a password manager. Anyone with this key and access to your
          OneAuth account could unlock your files.
        </p>
        <p
          className="mt-5 rounded-card border border-line bg-sunken p-4 font-mono text-[15px] leading-relaxed tracking-wider break-words select-all"
          data-testid="recovery-key"
        >
          {prepared.recovery.display}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={copyKey}>
            <Copy />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadKey}>
            <Download />
            Download as text file
          </Button>
        </div>

        <label className="mt-6 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I’ve saved my recovery key somewhere safe.
        </label>
        {saved ? (
          <div className="mt-4 max-w-xs">
            <label htmlFor="rk-check" className="text-sm font-medium">
              To confirm, type group {checkIndex + 1} of your key
            </label>
            <Input
              id="rk-check"
              className="mt-1.5 font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
              maxLength={4}
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              aria-invalid={check.length === 4 && !checkOk}
            />
            {check.length === 4 && !checkOk ? <p className="mt-1.5 text-[13px] text-danger">That doesn’t match. Check the key you saved.</p> : null}
          </div>
        ) : null}
        {error ? (
          <Notice tone="danger" title="Couldn’t create your vault" className="mt-5">
            {error}
          </Notice>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={create} disabled={!saved || !checkOk} loading={busy}>
            Create vault
          </Button>
          <Button variant="ghost" onClick={() => setPrepared(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
        <p className="mt-3 text-[13px] text-muted">You’ll be asked to confirm with your passkey.</p>
      </div>
    </Panel>
  );
}

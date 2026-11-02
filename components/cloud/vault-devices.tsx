'use client';

import { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';

/** Browsers with access to the vault, and requests waiting for approval. */
export function VaultDevices({ devices, vaultKey, onChange }: { devices: cloud.VaultDevice[]; vaultKey: Uint8Array; onChange: () => void }) {
  const [approving, setApproving] = useState<cloud.VaultDevice | null>(null);
  const [removing, setRemoving] = useState<cloud.VaultDevice | null>(null);
  const pending = devices.filter((d) => d.status === 'pending');
  const active = devices.filter((d) => d.status === 'active');

  return (
    <>
      {pending.length ? (
        <Panel className="border-warning/40">
          <PanelHeader title="Waiting for approval" description="Approve only browsers you’re setting up yourself." />
          <ul className="divide-y divide-line">
            {pending.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.device_name}</p>
                  <p className="text-[13px] text-muted">Asked to access your encrypted files</p>
                </div>
                <Button size="sm" onClick={() => setApproving(d)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Browsers with access" description="Each has its own key to your vault." />
        <ul className="divide-y divide-line">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <KeyRound className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.device_name}</p>
                  <p className="font-mono text-[12px] text-muted">{d.fingerprint}</p>
                </div>
              </div>
              {d.is_current ? (
                <Badge tone="accent">This browser</Badge>
              ) : (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(d)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <ApproveDialog key={approving?.id ?? 'none'} device={approving} vaultKey={vaultKey} onClose={() => setApproving(null)} onDone={onChange} />
      <RemoveDialog key={removing?.id ?? 'none'} device={removing} onClose={() => setRemoving(null)} onDone={onChange} />
    </>
  );
}

function ApproveDialog({ device, vaultKey, onClose, onDone }: { device: cloud.VaultDevice | null; vaultKey: Uint8Array; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Computed here from the public key we'll encrypt to, never taken from the server's label.
  useEffect(() => {
    if (device) void cloud.fingerprintOf(device.public_jwk).then(setCode);
  }, [device]);

  async function act(kind: 'approve' | 'deny') {
    if (!device) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'approve') await withStepUp(() => cloud.approveDevice(device, vaultKey));
      else await withStepUp(() => cloud.revokeVaultDevice(device.id));
      toast({ tone: 'success', message: kind === 'approve' ? `${device.device_name} can now open your files` : 'Request declined' });
      onClose();
      onDone();
    } catch (err) {
      if (!isCancellation(err)) setError(passkeyErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DialogRoot open={device !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Approve this browser?" description={device ? `${device.device_name} is asking to open your encrypted files.` : undefined}>
        <p className="text-[13px] font-medium text-muted">Its security code should be</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]" data-testid="approve-fingerprint">
          {code ?? '…'}
        </p>
        <Notice tone="warning" title="Compare the codes before approving" className="mt-4">
          Check that the code on the other screen is exactly the same. If it’s different, or you didn’t start this, decline. It may not be your
          device.
        </Notice>
        {error ? (
          <Notice tone="danger" title="That didn’t work" className="mt-4">
            {error}
          </Notice>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => act('deny')} loading={busy === 'deny'} disabled={busy !== null}>
            Codes don’t match: decline
          </Button>
          <Button onClick={() => act('approve')} loading={busy === 'approve'} disabled={busy !== null || !code}>
            Codes match: approve
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function RemoveDialog({ device, onClose, onDone }: { device: cloud.VaultDevice | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => cloud.revokeVaultDevice(device.id));
      toast({ tone: 'success', message: `${device.device_name} can no longer open your files` });
      onClose();
      onDone();
    } catch (err) {
      if (!isCancellation(err)) setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogRoot open={device !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Remove vault access?" description={device ? `${device.device_name} will no longer be able to download or decrypt your files.` : undefined}>
        <Notice tone="info" title="What this can’t undo">
          <span className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Files that browser already downloaded stay on it. If you think it’s compromised, also disconnect it in Devices.
          </span>
        </Notice>
        {error ? (
          <Notice tone="danger" title="That didn’t work" className="mt-4">
            {error}
          </Notice>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} loading={busy}>
            Remove access
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { KeyRound, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RelativeTime } from '@/components/ui/time';
import { useToast } from '@/components/ui/toast';
import { isCancellation, passkeyErrorMessage, withStepUp } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';

/** Browsers with access to the vault, requests waiting for approval, and key replacement. */
export function VaultDevices({
  userId,
  devices,
  vaultKey,
  keyVersion,
  vaultId,
  rotating,
  onChange,
  onRemoved,
  onForgotten,
  onReplaceKey,
}: {
  userId: string;
  devices: cloud.VaultDevice[];
  vaultKey: Uint8Array;
  keyVersion: number;
  vaultId: string;
  rotating: boolean;
  onChange: () => void;
  onRemoved: (name: string) => void;
  onForgotten: () => void;
  onReplaceKey: () => void;
}) {
  const [approving, setApproving] = useState<cloud.VaultDevice | null>(null);
  const [removing, setRemoving] = useState<cloud.VaultDevice | null>(null);
  const [showing, setShowing] = useState<cloud.VaultDevice | null>(null);
  const pending = devices.filter((d) => d.status === 'pending');
  const active = devices.filter((d) => d.status === 'active');

  return (
    <>
      {pending.length ? (
        <Panel className="border-warning/40">
          <PanelHeader title="Waiting for approval" description="Approve only browsers you’re setting up yourself, right now." />
          <ul className="divide-y divide-line">
            {pending.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.device_name}</p>
                  <p className="text-[13px] text-muted">
                    Asked <RelativeTime value={d.created_at} />
                  </p>
                </div>
                <Button size="sm" onClick={() => setApproving(d)} disabled={rotating}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
          {rotating ? <p className="px-5 pb-4 text-[12px] text-muted">Approvals resume once the key replacement finishes.</p> : null}
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Browsers with access"
          description="Each has its own key to your vault."
          action={
            <Button size="sm" variant="ghost" onClick={onReplaceKey} disabled={rotating}>
              <RefreshCw />
              Replace key
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <KeyRound className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {d.device_name}
                    {d.is_current ? <Badge tone="accent">This browser</Badge> : null}
                  </p>
                  <p className="font-mono text-[12px] text-muted">{d.fingerprint}</p>
                </div>
              </div>
              {!d.is_current ? (
                <Button size="sm" variant="ghost" onClick={() => setShowing(d)} aria-label={`Show confirmation code for ${d.device_name}`}>
                  Code
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(d)}>
                {d.is_current ? (
                  <>
                    <LogOut />
                    Remove
                  </>
                ) : (
                  'Remove'
                )}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <ApproveDialog
        key={approving?.id ?? 'none'}
        device={approving}
        vaultKey={vaultKey}
        keyVersion={keyVersion}
        vaultId={vaultId}
        onClose={() => setApproving(null)}
        onDone={onChange}
      />
      <CodeDialog key={showing?.id ?? 'none'} device={showing} vaultKey={vaultKey} vaultId={vaultId} keyVersion={keyVersion} onClose={() => setShowing(null)} />
      <RemoveDialog
        key={removing?.id ?? 'none'}
        device={removing}
        userId={userId}
        onClose={() => setRemoving(null)}
        onDone={(d) => (d.is_current ? onForgotten() : onRemoved(d.device_name))}
      />
    </>
  );
}

function ApproveDialog({
  device,
  vaultKey,
  keyVersion,
  vaultId,
  onClose,
  onDone,
}: {
  device: cloud.VaultDevice | null;
  vaultKey: Uint8Array;
  keyVersion: number;
  vaultId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
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
      if (kind === 'approve') {
        await withStepUp(() => cloud.approveDevice(device, vaultKey, keyVersion));
        toast({ tone: 'success', message: `${device.device_name} can now open your files` });
        // Second check (G5): the new browser shows a code from the key it actually received.
        setConfirmation(await cloud.confirmationCode(vaultKey, vaultId, keyVersion, device.public_jwk));
        onDone();
        return;
      }
      await withStepUp(() => cloud.revokeVaultDevice(device.id));
      toast({ tone: 'success', message: 'Request declined' });
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
        {confirmation ? (
          <div>
            <p className="text-sm font-medium">Approved. One last check:</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              The other browser now shows a confirmation code. It should be exactly this. If it isn’t, choose “They don’t match” there.
            </p>
            <p className="mt-3 font-mono text-2xl font-semibold tracking-[0.15em] sm:text-3xl" data-testid="approver-confirmation-code">
              {confirmation}
            </p>
            <div className="mt-5 flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
        <ol className="space-y-2 text-[13px] leading-relaxed text-muted">
          <li>1. Look at the other screen. It shows a security code.</li>
          <li>2. Check it matches this code exactly, all 12 characters.</li>
        </ol>
        <p className="mt-4 text-[13px] font-medium text-muted">Its security code should be</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.15em] sm:text-3xl" data-testid="approve-fingerprint">
          {code ?? '…'}
        </p>
        <Notice tone="warning" title="If the codes differ, decline" className="mt-4">
          A different code means this request may not come from your device, even if the name looks right. Approving gives it your vault key.
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
          </>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

function RemoveDialog({
  device,
  userId,
  onClose,
  onDone,
}: {
  device: cloud.VaultDevice | null;
  userId: string;
  onClose: () => void;
  onDone: (d: cloud.VaultDevice) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = device?.is_current ?? false;

  async function remove() {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      if (self) await withStepUp(() => cloud.forgetThisBrowser(userId, device.id));
      else await withStepUp(() => cloud.revokeVaultDevice(device.id));
      toast({ tone: 'success', message: self ? 'This browser’s vault key was deleted' : `${device.device_name} can no longer open your files` });
      onClose();
      onDone(device);
    } catch (err) {
      if (!isCancellation(err)) setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogRoot open={device !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={self ? 'Remove this browser?' : 'Remove vault access?'}
        description={
          self
            ? 'This browser’s vault key is deleted and its access withdrawn, for example before you hand the computer on. To use Cloud here again, approve it from another browser or use your recovery key.'
            : device
              ? `${device.device_name} will no longer be able to download or decrypt your files.`
              : undefined
        }
      >
        {!self ? (
          <Notice tone="info" title="What this can’t undo">
            <span className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Files that browser already downloaded stay on it. If you think it’s compromised, also disconnect it in Devices and replace your vault
              key afterwards.
            </span>
          </Notice>
        ) : null}
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
            {self ? 'Remove this browser' : 'Remove access'}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

/** The confirmation code another browser should show for the current vault key. */
function CodeDialog({
  device,
  vaultKey,
  vaultId,
  keyVersion,
  onClose,
}: {
  device: cloud.VaultDevice | null;
  vaultKey: Uint8Array;
  vaultId: string;
  keyVersion: number;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (device) void cloud.confirmationCode(vaultKey, vaultId, keyVersion, device.public_jwk).then(setCode);
  }, [device, vaultKey, vaultId, keyVersion]);
  return (
    <DialogRoot open={device !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Confirmation code" description={device ? `If ${device.device_name} asks you to check its confirmation code, it should show:` : undefined}>
        <p className="font-mono text-2xl font-semibold tracking-[0.15em] sm:text-3xl" data-testid="device-confirmation-code">
          {code ?? '…'}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          A different code means the vault key that browser received didn’t come from you. Choose “They don’t match” there, then replace your vault
          key.
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DropdownMenu as M } from 'radix-ui';
import { Check, ChevronDown, File as FileIcon, Folder, Lock, PinOff, Plus, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/client/api';
import { cn } from '@/lib/cn';
import * as cloud from '@/lib/vault/client';

const ACCENT: Record<cloud.Space['accent'], string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-500',
};
const KIND_LABEL: Record<cloud.Space['kind'], string> = { personal: 'Personal', work: 'Work', study: 'Study', other: 'Other' };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

type Data = Awaited<ReturnType<typeof cloud.listSpaces>>;

export function SpaceApp({ userId, deviceId, cloudEnabled }: { userId: string; deviceId: string; cloudEnabled: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'settings' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await cloud.listSpaces());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <Notice tone="danger" title="Couldn’t load your spaces">{error}</Notice>;
  if (!data) return <Skeleton className="h-48 w-full" />;
  const current = data.spaces.find((s) => s.id === data.selectedId) ?? data.spaces[0];

  async function choose(id: string) {
    try {
      await cloud.selectSpace(id);
      await load();
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <M.Root>
          <M.Trigger asChild>
            <button
              type="button"
              className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-2.5 shadow-low hover:border-line-strong"
>
              <span className={cn('size-3 rounded-full', ACCENT[current.accent])} aria-hidden="true" />
              <span className="text-left">
                <span className="block text-[15px] font-semibold">
                  <span className="sr-only">Current space: </span>
                  {current.name}
                </span>
                <span className="block text-[12px] text-muted">{KIND_LABEL[current.kind]}</span>
              </span>
              <ChevronDown className="size-4 text-muted" aria-hidden="true" />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content align="start" sideOffset={6} className="z-50 min-w-60 rounded-card border border-line bg-raised p-1 shadow-high">
              <M.Label className="px-2.5 py-1.5 text-[12px] text-muted">Your spaces on this device</M.Label>
              {data.spaces.map((s) => (
                <M.Item
                  key={s.id}
                  onSelect={() => choose(s.id)}
                  className="flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken"
                >
                  <span className={cn('size-2.5 rounded-full', ACCENT[s.accent])} aria-hidden="true" />
                  <span className="flex-1">{s.name}</span>
                  {s.id === current.id ? <Check className="size-4 text-accent-text" aria-label="Current" /> : null}
                </M.Item>
              ))}
              <M.Separator className="my-1 h-px bg-line" />
              <M.Item
                onSelect={() => setDialog('new')}
                className="flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken"
              >
                <Plus className="size-4" aria-hidden="true" />
                New space
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
        <Button variant="secondary" size="sm" onClick={() => setDialog('settings')}>
          <Settings2 />
          Space settings
        </Button>
      </div>

      {!current.all_devices ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Lock className="size-3.5" aria-hidden="true" />
          Shown only on {current.device_ids.length === 1 ? '1 device' : `${current.device_ids.length} devices`}.
        </p>
      ) : null}

      <Pins key={current.id} space={current} userId={userId} cloudEnabled={cloudEnabled} />

      <NewSpaceDialog
        key={dialog === 'new' ? 'new-open' : 'new-closed'}
        open={dialog === 'new'}
        onClose={() => setDialog(null)}
        onDone={async () => {
          setDialog(null);
          await load();
        }}
      />
      <SettingsDialog
        key={dialog === 'settings' ? `settings-${current.id}` : 'settings-closed'}
        open={dialog === 'settings'}
        space={current}
        devices={data.devices}
        deviceId={deviceId}
        canDelete={data.spaces.length > 1}
        onClose={() => setDialog(null)}
        onDone={async (msg) => {
          setDialog(null);
          toast({ tone: 'success', message: msg });
          await load();
        }}
      />
    </div>
  );
}

type PinData = Awaited<ReturnType<typeof cloud.listPins>>;

function Pins({ space, userId, cloudEnabled }: { space: cloud.Space; userId: string; cloudEnabled: boolean }) {
  const toast = useToast();
  const [pins, setPins] = useState<PinData | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [vault, setVault] = useState<{ vaultKey: Uint8Array; vaultId: string } | null | undefined>(undefined);

  const load = useCallback(async () => {
    const [p, v] = await Promise.all([cloud.listPins(space.id), cloudEnabled ? cloud.tryUnlock(userId) : Promise.resolve(null)]);
    setPins(p);
    setVault(v);
    if (v) {
      const nk = await cloud.nameKeyFor(v.vaultKey, v.vaultId);
      const entries = await Promise.all([
        ...p.files.map(async (f) => [f.id, (await cloud.openMeta(v.vaultKey, f).catch(() => null))?.name ?? 'Unreadable file'] as const),
        ...p.folders.map(async (f) => [f.id, await cloud.folderName(nk, f).catch(() => 'Unreadable folder')] as const),
      ]);
      setNames(Object.fromEntries(entries));
    }
  }, [space.id, cloudEnabled, userId]);
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => toast({ tone: 'error', message: errMsg(e) })), 0);
    return () => clearTimeout(t);
  }, [load, toast]);

  async function open(f: PinData['files'][number]) {
    if (!vault) return;
    try {
      const { blob, meta } = await cloud.downloadFile(vault.vaultKey, f);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    }
  }

  async function remove(pinId: string) {
    try {
      await cloud.unpinFromSpace(space.id, pinId);
      await load();
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    }
  }

  const count = (pins?.files.length ?? 0) + (pins?.folders.length ?? 0);

  return (
    <Panel>
      <PanelHeader title="Pinned" description="Files and folders from Cloud that you want close at hand in this space." />
      {pins === null || vault === undefined ? (
        <div className="p-5">
          <Skeleton className="h-6 w-1/2" />
        </div>
      ) : count === 0 ? (
        <EmptyState
          icon={<Folder />}
          title="Nothing pinned yet"
          action={
            cloudEnabled ? (
              <ButtonLink href="/cloud" variant="secondary" size="sm">
                Open Cloud
              </ButtonLink>
            ) : undefined
          }
        >
          {cloudEnabled ? 'In Cloud, open an item’s menu and choose “Pin to space”.' : 'Pinning needs OneAuth Cloud, which isn’t available on this deployment yet.'}
        </EmptyState>
      ) : (
        <>
          {!vault ? (
            <Notice tone="info" title="Names are encrypted" className="m-4">
              Open Cloud on this browser to unlock your vault and see what’s pinned here.
            </Notice>
          ) : null}
          <ul className="divide-y divide-line" data-testid="space-pins">
            {pins.folders.map((f) => (
              <li key={f.pin_id} className="flex items-center gap-3 px-5 py-2.5">
                <Folder className="size-5 shrink-0 text-accent-text" aria-hidden="true" />
                <Link href={`/cloud?folder=${f.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {vault ? names[f.id] : 'Encrypted folder'}
                </Link>
                <UnpinButton onClick={() => remove(f.pin_id)} />
              </li>
            ))}
            {pins.files.map((f) => (
              <li key={f.pin_id} className="flex items-center gap-3 px-5 py-2.5">
                <FileIcon className="size-5 shrink-0 text-muted" aria-hidden="true" />
                <button type="button" disabled={!vault} onClick={() => open(f)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline disabled:no-underline">
                  {vault ? names[f.id] : 'Encrypted file'}
                </button>
                <span className="text-[12px] text-muted tabular">{cloud.formatBytes(f.size_bytes)}</span>
                <UnpinButton onClick={() => remove(f.pin_id)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function UnpinButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-sunken hover:text-fg" aria-label="Unpin">
      <PinOff className="size-4" />
    </button>
  );
}

function KindSelect({ value, onChange }: { value: cloud.Space['kind']; onChange: (k: cloud.Space['kind']) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Type</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {(Object.keys(KIND_LABEL) as cloud.Space['kind'][]).map((k) => (
          <label key={k} className={cn('cursor-pointer rounded-control border px-3 py-1.5 text-sm', value === k ? 'border-accent bg-accent-soft' : 'border-line')}>
            <input type="radio" name="kind" className="sr-only" checked={value === k} onChange={() => onChange(k)} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NewSpaceDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<cloud.Space['kind']>('work');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogRoot open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New space" description="For example, keep work things separate from personal ones.">
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await cloud.createSpace(name, kind);
              await onDone();
            } catch (err) {
              setError(errMsg(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="space-name" className="text-sm font-medium">
              Name
            </label>
            <Input id="space-name" className="mt-1.5" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <KindSelect value={kind} onChange={setKind} />
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              Create space
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function SettingsDialog(props: {
  open: boolean;
  space: cloud.Space;
  devices: { id: string; name: string }[];
  deviceId: string;
  canDelete: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const { space, devices, deviceId } = props;
  const [name, setName] = useState(space.name);
  const [kind, setKind] = useState(space.kind);
  const [accent, setAccent] = useState(space.accent);
  const [allDevices, setAllDevices] = useState(space.all_devices);
  const [chosen, setChosen] = useState<string[]>(space.all_devices ? [deviceId] : space.device_ids);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hidesHere = !allDevices && !chosen.includes(deviceId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      await cloud.updateSpace(space.id, { name, kind, accent, allDevices, ...(allDevices ? {} : { deviceIds: chosen }) });
      await props.onDone('Space updated');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      await cloud.deleteSpace(space.id);
      await props.onDone(`${space.name} deleted`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DialogRoot open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent title="Space settings">
        <form className="space-y-5" onSubmit={save}>
          <div>
            <label htmlFor="space-settings-name" className="text-sm font-medium">
              Name
            </label>
            <Input id="space-settings-name" className="mt-1.5" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <KindSelect value={kind} onChange={setKind} />
          <fieldset>
            <legend className="text-sm font-medium">Colour</legend>
            <div className="mt-2 flex gap-2">
              {(Object.keys(ACCENT) as cloud.Space['accent'][]).map((a) => (
                <label key={a} className="cursor-pointer">
                  <input type="radio" name="accent" className="peer sr-only" checked={accent === a} onChange={() => setAccent(a)} aria-label={a} />
                  <span className={cn('block size-8 rounded-full ring-offset-2 ring-offset-raised peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:ring-2 peer-focus-visible:ring-accent', ACCENT[a])} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Show this space on</legend>
            <label className="mt-2 flex items-center gap-3 text-sm">
              <input type="radio" name="devices" checked={allDevices} onChange={() => setAllDevices(true)} className="size-4" />
              All my devices
            </label>
            <label className="mt-2 flex items-center gap-3 text-sm">
              <input type="radio" name="devices" checked={!allDevices} onChange={() => setAllDevices(false)} className="size-4" />
              Only the devices I choose
            </label>
            {!allDevices ? (
              <ul className="mt-3 space-y-2 rounded-card border border-line p-3">
                {devices.map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={chosen.includes(d.id)}
                        onChange={(e) => setChosen((c) => (e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id)))}
                      />
                      {d.name}
                      {d.id === deviceId ? <Badge tone="accent">This device</Badge> : null}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {hidesHere ? (
              <p className="mt-2 text-[13px] text-warning">This space will disappear from this device when you save.</p>
            ) : null}
          </fieldset>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {props.canDelete ? (
              <Button type="button" variant="ghost" className="text-danger" onClick={remove} loading={busy === 'delete'} disabled={busy !== null}>
                Delete space
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={props.onClose} disabled={busy !== null}>
                Cancel
              </Button>
              <Button type="submit" loading={busy === 'save'} disabled={busy !== null || !name.trim() || (!allDevices && chosen.length === 0)}>
                Save
              </Button>
            </div>
          </div>
        </form>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Deleting a space removes its pins only. Files stay in Cloud. Space names are visible to OneAuth; pinned file names stay encrypted.
        </p>
      </DialogContent>
    </DialogRoot>
  );
}

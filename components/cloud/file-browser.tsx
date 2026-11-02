'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DropdownMenu as M } from 'radix-ui';
import {
  ChevronRight,
  Clock,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/client/api';
import { cn } from '@/lib/cn';
import * as cloud from '@/lib/vault/client';

type View = 'folder' | 'recent' | 'favorites' | 'trash';
interface FileItem {
  kind: 'file';
  row: cloud.FileRow;
  meta: cloud.FileMeta | null;
}
interface FolderItem {
  kind: 'folder';
  row: cloud.FolderRow;
  name: string | null;
}
type Item = FileItem | FolderItem;
interface Transfer {
  id: string;
  name: string;
  fraction: number;
  phase: string;
  error?: string;
}

const VIEWS: { id: View; label: string; icon: typeof HardDrive }[] = [
  { id: 'folder', label: 'My files', icon: HardDrive },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'favorites', label: 'Favourites', icon: Star },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

export function FileBrowser({ vaultKey, vaultId, usage, onUsageChange }: { vaultKey: Uint8Array; vaultId: string; usage: cloud.VaultState['usage']; onUsageChange: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<View>('folder');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [nameKey, setNameKey] = useState<CryptoKey | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'new-folder' } | { kind: 'rename'; item: Item } | { kind: 'delete'; item: Item } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void cloud.nameKeyFor(vaultKey, vaultId).then(setNameKey);
  }, [vaultKey, vaultId]);

  const load = useCallback(async () => {
    if (!nameKey) return;
    setError(null);
    try {
      const res = await cloud.listItems(view, view === 'folder' ? folderId : null);
      const folders: Item[] = await Promise.all(
        res.folders.map(async (row) => ({ kind: 'folder' as const, row, name: await cloud.folderName(nameKey, row).catch(() => null) })),
      );
      const files: Item[] = await Promise.all(
        res.files.map(async (row) => ({ kind: 'file' as const, row, meta: await cloud.openMeta(vaultKey, row).catch(() => null) })),
      );
      const byName = (a: Item, b: Item) => label(a).localeCompare(label(b));
      setItems(view === 'recent' ? [...folders, ...files] : [...folders.sort(byName), ...files.sort(byName)]);
      setPath(await Promise.all(res.path.map(async (p) => ({ id: p.id, name: await cloud.folderName(nameKey, p).catch(() => 'Folder') }))));
    } catch (e) {
      setError(errMsg(e));
      setItems([]);
    }
  }, [nameKey, vaultKey, view, folderId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    onUsageChange();
  }, [load, onUsageChange]);

  function go(v: View, folder: string | null = null) {
    setView(v);
    setFolderId(folder);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    const target = view === 'folder' ? folderId : null;
    for (const file of Array.from(list)) {
      const id = crypto.randomUUID();
      setTransfers((t) => [...t, { id, name: file.name, fraction: 0, phase: 'encrypting' }]);
      const update = (patch: Partial<Transfer>) => setTransfers((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        await cloud.uploadFile(vaultKey, file, target, (fraction, phase) => update({ fraction, phase }));
        setTransfers((t) => t.filter((x) => x.id !== id));
        toast({ tone: 'success', message: `${file.name} uploaded and encrypted` });
      } catch (e) {
        update({ error: errMsg(e) });
      }
    }
    if (fileInput.current) fileInput.current.value = '';
    if (view !== 'folder') go('folder', target);
    await refresh();
  }

  async function download(item: FileItem) {
    const id = crypto.randomUUID();
    const name = item.meta?.name ?? 'file';
    setTransfers((t) => [...t, { id, name, fraction: 0, phase: 'downloading' }]);
    try {
      const { blob, meta } = await cloud.downloadFile(vaultKey, item.row, (fraction, phase) =>
        setTransfers((t) => t.map((x) => (x.id === id ? { ...x, fraction, phase } : x))),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setTransfers((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setTransfers((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof ApiError ? e.message : 'This file couldn’t be decrypted. It may be damaged.' } : x)));
    }
  }

  async function act(fn: () => Promise<unknown>, success?: string) {
    try {
      await fn();
      if (success) toast({ tone: 'success', message: success });
      await refresh();
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    }
  }

  const trashed = view === 'trash';
  const usedPct = usage.quota ? Math.min(100, ((usage.used + usage.reserved) / usage.quota) * 100) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Cloud views" className="flex gap-1 overflow-x-auto lg:flex-col">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => go(v.id)}
            aria-current={view === v.id ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors',
              view === v.id ? 'bg-sunken font-medium text-fg' : 'text-muted hover:bg-sunken/60 hover:text-fg',
            )}
          >
            <v.icon className="size-4" aria-hidden="true" />
            {v.label}
          </button>
        ))}
        <div className="mt-4 hidden px-3 lg:block">
          <p className="text-[12px] text-muted">Storage</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-1.5 text-[12px] text-muted tabular">
            {cloud.formatBytes(usage.used)} of {cloud.formatBytes(usage.quota)}
          </p>
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumbs view={view} path={path} onNavigate={(id) => go('folder', id)} />
          {!trashed ? (
            <div className="flex gap-2">
              {view === 'folder' ? (
                <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'new-folder' })}>
                  <FolderPlus />
                  New folder
                </Button>
              ) : null}
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload />
                Upload
              </Button>
              <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose files to upload" data-testid="upload-input" onChange={(e) => uploadFiles(e.target.files)} />
            </div>
          ) : null}
        </div>

        {transfers.length ? (
          <ul className="space-y-2" aria-live="polite">
            {transfers.map((t) => (
              <li key={t.id} className="rounded-card border border-line bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{t.name}</span>
                  {t.error ? (
                    <button type="button" className="text-muted hover:text-fg" aria-label="Dismiss" onClick={() => setTransfers((x) => x.filter((y) => y.id !== t.id))}>
                      <X className="size-4" />
                    </button>
                  ) : (
                    <span className="shrink-0 text-[12px] text-muted capitalize">
                      {t.phase} {Math.round(t.fraction * 100)}%
                    </span>
                  )}
                </div>
                {t.error ? (
                  <p className="mt-1 text-[13px] text-danger">{t.error}</p>
                ) : (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${t.fraction * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <Notice tone="danger" title="Couldn’t load your files">
            {error}
          </Notice>
        ) : null}

        <Panel>
          {items === null ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={trashed ? <Trash2 /> : view === 'favorites' ? <Star /> : <Folder />} title={emptyTitle(view)}>
              {view === 'folder' ? 'Use test files only during the developer preview.' : null}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line" data-testid="cloud-items">
              {items.map((item) => (
                <Row
                  key={item.row.id}
                  item={item}
                  trashed={trashed}
                  onOpen={() => (item.kind === 'folder' ? go('folder', item.row.id) : download(item))}
                  onDownload={() => item.kind === 'file' && download(item)}
                  onRename={() => setDialog({ kind: 'rename', item })}
                  onFavorite={() => item.kind === 'file' && act(() => cloud.updateFile(item.row.id, { favorite: !item.row.favorite }))}
                  onTrash={() =>
                    act(
                      () => (item.kind === 'file' ? cloud.updateFile(item.row.id, { trashed: true }) : cloud.updateFolder(item.row.id, { trashed: true })),
                      'Moved to trash',
                    )
                  }
                  onRestore={() =>
                    act(() => (item.kind === 'file' ? cloud.updateFile(item.row.id, { trashed: false }) : cloud.updateFolder(item.row.id, { trashed: false })), 'Restored')
                  }
                  onDelete={() => setDialog({ kind: 'delete', item })}
                />
              ))}
            </ul>
          )}
        </Panel>
        <p className="text-[12px] text-muted lg:hidden tabular">
          {cloud.formatBytes(usage.used)} of {cloud.formatBytes(usage.quota)} used
        </p>
      </div>

      <NameDialog
        key={dialog?.kind === 'rename' ? `rename-${dialog.item.row.id}` : dialog?.kind ?? 'closed'}
        open={dialog?.kind === 'new-folder' || dialog?.kind === 'rename'}
        title={dialog?.kind === 'rename' ? 'Rename' : 'New folder'}
        initial={dialog?.kind === 'rename' ? label(dialog.item) : ''}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (!nameKey) return;
          if (dialog?.kind === 'new-folder') await cloud.createFolder(nameKey, folderId, name);
          else if (dialog?.kind === 'rename') {
            const it = dialog.item;
            if (it.kind === 'folder') await cloud.renameFolder(nameKey, it.row.id, name);
            else if (it.meta) await cloud.renameFile(vaultKey, it.row, it.meta, name);
          }
          setDialog(null);
          await refresh();
        }}
      />
      <DeleteDialog
        key={dialog?.kind === 'delete' ? dialog.item.row.id : 'closed'}
        item={dialog?.kind === 'delete' ? dialog.item : null}
        onClose={() => setDialog(null)}
        onConfirm={async (item) => {
          if (item.kind === 'file') await cloud.deleteFile(item.row.id);
          else await cloud.deleteFolder(item.row.id);
          setDialog(null);
          toast({ tone: 'success', message: 'Deleted permanently' });
          await refresh();
        }}
      />
    </div>
  );
}

function label(item: Item): string {
  return item.kind === 'folder' ? (item.name ?? 'Unreadable folder') : (item.meta?.name ?? 'Unreadable file');
}

function emptyTitle(view: View) {
  return { folder: 'No files here yet', recent: 'Nothing recent', favorites: 'No favourites yet', trash: 'Trash is empty' }[view];
}

function Breadcrumbs({ view, path, onNavigate }: { view: View; path: { id: string; name: string }[]; onNavigate: (id: string | null) => void }) {
  if (view !== 'folder') return <h2 className="text-[15px] font-semibold">{VIEWS.find((v) => v.id === view)!.label}</h2>;
  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1 text-[15px]">
      <button type="button" className={cn('shrink-0 rounded px-1', path.length ? 'text-muted hover:text-fg' : 'font-semibold')} onClick={() => onNavigate(null)}>
        My files
      </button>
      {path.map((p, i) => (
        <span key={p.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
          {i === path.length - 1 ? (
            <span className="truncate font-semibold" aria-current="page">
              {p.name}
            </span>
          ) : (
            <button type="button" className="truncate rounded px-1 text-muted hover:text-fg" onClick={() => onNavigate(p.id)}>
              {p.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function Row(props: {
  item: Item;
  trashed: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onFavorite: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { item, trashed } = props;
  const name = label(item);
  const Icon = item.kind === 'folder' ? Folder : FileIcon;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <button type="button" onClick={trashed ? undefined : props.onOpen} disabled={trashed} className="flex min-w-0 flex-1 items-center gap-3 rounded text-left disabled:cursor-default">
        <Icon className={cn('size-5 shrink-0', item.kind === 'folder' ? 'text-accent-text' : 'text-muted')} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block text-[12px] text-muted tabular">
            {item.kind === 'file' ? `${cloud.formatBytes(item.meta?.size ?? item.row.size_bytes)} · ` : 'Folder · '}
            {new Date(item.row.updated_at).toLocaleDateString()}
          </span>
        </span>
      </button>
      {item.kind === 'file' && item.row.favorite && !trashed ? <Star className="size-4 shrink-0 fill-current text-warning" aria-label="Favourite" /> : null}
      <M.Root>
        <M.Trigger asChild>
          <button type="button" className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-sunken hover:text-fg" aria-label={`Actions for ${name}`}>
            <MoreHorizontal className="size-4" />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-card border border-line bg-raised p-1 shadow-high">
            {trashed ? (
              <>
                <MenuItem icon={RotateCcw} onSelect={props.onRestore}>
                  Restore
                </MenuItem>
                <MenuItem icon={Trash2} onSelect={props.onDelete} danger>
                  Delete permanently
                </MenuItem>
              </>
            ) : (
              <>
                {item.kind === 'file' ? (
                  <MenuItem icon={Download} onSelect={props.onDownload}>
                    Download
                  </MenuItem>
                ) : null}
                {item.kind === 'file' && !item.meta ? null : (
                  <MenuItem icon={Pencil} onSelect={props.onRename}>
                    Rename
                  </MenuItem>
                )}
                {item.kind === 'file' ? (
                  <MenuItem icon={Star} onSelect={props.onFavorite}>
                    {item.row.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  </MenuItem>
                ) : null}
                <MenuItem icon={Trash2} onSelect={props.onTrash} danger>
                  Move to trash
                </MenuItem>
              </>
            )}
          </M.Content>
        </M.Portal>
      </M.Root>
    </li>
  );
}

function MenuItem({ icon: Icon, children, onSelect, danger }: { icon: typeof Star; children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <M.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-sunken',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </M.Item>
  );
}

function NameDialog({ open, title, initial, onClose, onSubmit }: { open: boolean; title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim();
  const invalid = !clean || clean.length > 200 || /[/\\]/.test(clean);
  return (
    <DialogRoot open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description="Names are encrypted before they leave this browser.">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (invalid) return;
            setBusy(true);
            setError(null);
            try {
              await onSubmit(clean);
            } catch (err) {
              setError(errMsg(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="item-name" className="sr-only">
            Name
          </label>
          <Input id="item-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          {/[/\\]/.test(clean) ? <p className="mt-1.5 text-[13px] text-danger">Names can’t contain / or \.</p> : null}
          {error ? <p className="mt-1.5 text-[13px] text-danger">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={invalid}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function DeleteDialog({ item, onClose, onConfirm }: { item: Item | null; onClose: () => void; onConfirm: (item: Item) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogRoot open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Delete permanently?" description={item ? `“${label(item)}” will be deleted and can’t be restored.` : undefined}>
        <p className="text-[13px] leading-relaxed text-muted">
          The encrypted data is removed from OneAuth’s storage now. Database backups may hold the encrypted copy until they expire, and it can’t be
          read without your vault key.
        </p>
        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              if (!item) return;
              setBusy(true);
              try {
                await onConfirm(item);
              } catch (err) {
                setError(errMsg(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete permanently
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

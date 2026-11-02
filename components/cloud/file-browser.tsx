'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu as M } from 'radix-ui';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronRight,
  Clock,
  CornerLeftUp,
  Download,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  Search,
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
import { VaultCryptoError } from '@/lib/vault/crypto';

type View = 'folder' | 'recent' | 'favorites' | 'trash';
type SortKey = 'name' | 'updated' | 'size';
interface FileItem {
  kind: 'file';
  row: cloud.FileRow;
  meta: cloud.FileMeta | null;
  location?: string;
}
interface FolderItem {
  kind: 'folder';
  row: cloud.FolderRow;
  name: string | null;
  location?: string;
}
type Item = FileItem | FolderItem;
interface Transfer {
  id: string;
  name: string;
  direction: 'up' | 'down';
  fraction: number;
  phase: 'encrypting' | 'uploading' | 'downloading' | 'decrypting';
  error?: string;
  retry?: () => void;
}

const VIEWS: { id: View; label: string; icon: typeof HardDrive }[] = [
  { id: 'folder', label: 'My files', icon: HardDrive },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'favorites', label: 'Favourites', icon: Star },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

const PHASE_LABEL: Record<Transfer['phase'], string> = {
  encrypting: 'Encrypting on this device',
  uploading: 'Uploading encrypted data',
  downloading: 'Downloading encrypted data',
  decrypting: 'Decrypting on this device',
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof VaultCryptoError) return 'This item couldn’t be decrypted. It may have been damaged or changed.';
  return 'Something went wrong. Please try again.';
}

function label(item: Item): string {
  return item.kind === 'folder' ? (item.name ?? 'Unreadable folder') : (item.meta?.name ?? 'Unreadable file');
}

export function FileBrowser({
  vaultKey,
  keyVersion,
  vaultId,
  usage,
  readOnly = false,
  onUsageChange,
  initialFolder = null,
}: {
  vaultKey: Uint8Array;
  keyVersion: number;
  vaultId: string;
  usage: cloud.VaultState['usage'];
  readOnly?: boolean;
  onUsageChange: () => void;
  initialFolder?: string | null;
}) {
  const toast = useToast();
  const [view, setView] = useState<View>('folder');
  const [folderId, setFolderId] = useState<string | null>(initialFolder);
  const [items, setItems] = useState<Item[] | null>(null);
  const [everything, setEverything] = useState<{ items: Item[]; folderNames: Map<string, string> } | null>(null);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [nameKey, setNameKey] = useState<CryptoKey | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [dragging, setDragging] = useState(false);
  const [space, setSpace] = useState<{ id: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<
    { kind: 'new-folder' } | { kind: 'rename'; item: Item } | { kind: 'delete'; item: Item } | { kind: 'move'; item: Item } | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  useEffect(() => {
    void cloud.nameKeyFor(vaultKey, vaultId).then(setNameKey);
  }, [vaultKey, vaultId]);

  // The space this device has open (for "Pin to …") and its preferred sort order.
  useEffect(() => {
    void cloud
      .listSpaces()
      .then((d) => {
        const s = d.spaces.find((x) => x.id === d.selectedId) ?? d.spaces[0];
        if (!s) return;
        setSpace({ id: s.id, name: s.name });
        const pref = s.prefs?.cloudSort;
        if (pref === 'updated' || pref === 'size' || pref === 'name') setSort({ key: pref, dir: pref === 'name' ? 1 : -1 });
      })
      .catch(() => setSpace(null));
  }, []);

  const decryptRows = useCallback(
    async (res: Awaited<ReturnType<typeof cloud.listItems>>) => {
      if (!nameKey) return { folders: [] as Item[], files: [] as Item[] };
      const folders: Item[] = await Promise.all(
        res.folders.map(async (row) => ({ kind: 'folder' as const, row, name: await cloud.folderName(nameKey, row).catch(() => null) })),
      );
      const files: Item[] = await Promise.all(
        res.files.map(async (row) => ({ kind: 'file' as const, row, meta: await cloud.openMeta(vaultKey, row).catch(() => null) })),
      );
      return { folders, files };
    },
    [nameKey, vaultKey],
  );

  const load = useCallback(async () => {
    if (!nameKey) return;
    setError(null);
    try {
      const res = await cloud.listItems(view, view === 'folder' ? folderId : null);
      const { folders, files } = await decryptRows(res);
      setItems([...folders, ...files]);
      setPath(await Promise.all(res.path.map(async (p) => ({ id: p.id, name: await cloud.folderName(nameKey, p).catch(() => 'Folder') }))));
    } catch (e) {
      setError(errMsg(e));
      setItems([]);
    }
  }, [nameKey, view, folderId, decryptRows]);

  /** Every live file and folder, decrypted: for search and "Move to…". */
  const loadEverything = useCallback(async () => {
    if (!nameKey) return null;
    const res = await cloud.listItems('all', null);
    const { folders, files } = await decryptRows(res);
    const folderNames = new Map(folders.map((f) => [f.row.id, label(f)]));
    const withLocation = (i: Item): Item => {
      const parent = i.kind === 'file' ? i.row.folder_id : i.row.parent_id;
      return { ...i, location: parent ? (folderNames.get(parent) ?? 'Folder') : 'My files' };
    };
    const all = { items: [...folders, ...files].map(withLocation), folderNames };
    setEverything(all);
    return all;
  }, [nameKey, decryptRows]);

  useEffect(() => {
    const t = setTimeout(() => {
      setItems(null);
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!searching || everything) return;
    const t = setTimeout(() => void loadEverything().catch((e) => setError(errMsg(e))), 0);
    return () => clearTimeout(t);
  }, [searching, everything, loadEverything]);

  const refresh = useCallback(async () => {
    setEverything(null);
    await load();
    onUsageChange();
  }, [load, onUsageChange]);

  function go(v: View, folder: string | null = null) {
    setQuery('');
    setView(v);
    setFolderId(folder);
  }

  const shown = useMemo(() => {
    const source = searching ? (everything?.items ?? null) : items;
    if (!source) return null;
    const q = query.trim().toLowerCase();
    const filtered = q ? source.filter((i) => label(i).toLowerCase().includes(q)) : source;
    const value = (i: Item) =>
      sort.key === 'name' ? label(i).toLowerCase() : sort.key === 'size' ? (i.kind === 'file' ? (i.meta?.size ?? i.row.size_bytes) : -1) : new Date(i.row.updated_at).getTime();
    const cmp = (a: Item, b: Item) => {
      const va = value(a);
      const vb = value(b);
      return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    };
    // Folders first, then files, each sorted.
    return [...filtered.filter((i) => i.kind === 'folder').sort(cmp), ...filtered.filter((i) => i.kind === 'file').sort(cmp)];
  }, [items, everything, searching, query, sort]);

  const setTransfer = (id: string, patch: Partial<Transfer>) => setTransfers((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const dropTransfer = (id: string) => setTransfers((t) => t.filter((x) => x.id !== id));

  async function uploadOne(file: File, target: string | null, existingId?: string) {
    const id = existingId ?? crypto.randomUUID();
    const retry = () => void uploadOne(file, target, id).then(refresh);
    if (existingId) setTransfer(id, { error: undefined, fraction: 0, phase: 'encrypting' });
    else setTransfers((t) => [...t, { id, name: file.name, direction: 'up', fraction: 0, phase: 'encrypting', retry }]);
    try {
      await cloud.uploadFile(vaultKey, keyVersion, file, target, (fraction, phase) => setTransfer(id, { fraction, phase }));
      dropTransfer(id);
      toast({ tone: 'success', message: `${file.name} encrypted and uploaded` });
    } catch (e) {
      setTransfer(id, { error: errMsg(e), retry });
    }
  }

  async function uploadFiles(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length || readOnly) return;
    const target = view === 'folder' ? folderId : null;
    for (const file of files) await uploadOne(file, target);
    if (fileInput.current) fileInput.current.value = '';
    if (view !== 'folder') go('folder', target);
    await refresh();
  }

  async function download(item: FileItem, existingId?: string) {
    const id = existingId ?? crypto.randomUUID();
    const name = item.meta?.name ?? 'file';
    const retry = () => void download(item, id);
    if (existingId) setTransfer(id, { error: undefined, fraction: 0, phase: 'downloading' });
    else setTransfers((t) => [...t, { id, name, direction: 'down', fraction: 0, phase: 'downloading', retry }]);
    try {
      const { blob, meta } = await cloud.downloadFile(vaultKey, item.row, (fraction, phase) => setTransfer(id, { fraction, phase }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      dropTransfer(id);
    } catch (e) {
      setTransfer(id, { error: errMsg(e), retry });
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
  const parent = path.length > 1 ? path[path.length - 2].id : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Cloud views" className="flex gap-1 overflow-x-auto lg:flex-col">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => go(v.id)}
            aria-current={view === v.id && !searching ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors',
              view === v.id && !searching ? 'bg-sunken font-medium text-fg' : 'text-muted hover:bg-sunken/60 hover:text-fg',
            )}
          >
            <v.icon className="size-4" aria-hidden="true" />
            {v.label}
          </button>
        ))}
        <div className="mt-4 hidden px-3 lg:block">
          <p className="text-[12px] text-muted">Storage</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
            <div className={cn('h-full rounded-full', usedPct > 90 ? 'bg-warning' : 'bg-accent')} style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-1.5 text-[12px] text-muted tabular">
            {cloud.formatBytes(usage.used)} of {cloud.formatBytes(usage.quota)}
          </p>
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {searching ? (
            <h2 className="text-[15px] font-semibold">Search results</h2>
          ) : (
            <Breadcrumbs view={view} path={path} onNavigate={(id) => go('folder', id)} />
          )}
          {!trashed ? (
            <div className="flex gap-2">
              {view === 'folder' && !searching ? (
                <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'new-folder' })} disabled={readOnly}>
                  <FolderPlus />
                  New folder
                </Button>
              ) : null}
              <Button size="sm" onClick={() => fileInput.current?.click()} disabled={readOnly}>
                <Upload />
                Upload
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose files to upload"
                data-testid="upload-input"
                onChange={(e) => uploadFiles(e.target.files)}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <label htmlFor="cloud-search" className="sr-only">
              Search all files by name
            </label>
            <Input
              id="cloud-search"
              type="search"
              placeholder="Search all files"
              className="h-10 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label htmlFor="cloud-sort" className="sr-only">
            Sort by
          </label>
          <select
            id="cloud-sort"
            className="h-10 rounded-control border border-line bg-surface px-3 text-sm"
            value={sort.key}
            onChange={(e) => setSort({ key: e.target.value as SortKey, dir: e.target.value === 'name' ? 1 : -1 })}
          >
            <option value="name">Name</option>
            <option value="updated">Last changed</option>
            <option value="size">Size</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            className="h-10 w-10 px-0"
            onClick={() => setSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))}
            aria-label={sort.dir === 1 ? 'Sorted ascending. Switch to descending' : 'Sorted descending. Switch to ascending'}
          >
            {sort.dir === 1 ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {shown ? `${shown.length} ${shown.length === 1 ? 'item' : 'items'}` : 'Loading'}
        </p>

        {readOnly ? (
          <p className="text-[13px] text-muted">Uploads and new folders are paused while your vault key is being replaced.</p>
        ) : null}

        {transfers.length ? (
          <ul className="space-y-2" aria-label="Transfers" aria-live="polite">
            {transfers.map((t) => (
              <li key={t.id} className="rounded-card border border-line bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {t.direction === 'up' ? <Upload className="size-4 shrink-0 text-muted" aria-hidden="true" /> : <Download className="size-4 shrink-0 text-muted" aria-hidden="true" />}
                    <span className="truncate">{t.name}</span>
                  </span>
                  {t.error ? (
                    <span className="flex shrink-0 gap-1">
                      {t.retry ? (
                        <Button size="sm" variant="secondary" onClick={t.retry}>
                          <RotateCcw />
                          Retry
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        className="grid size-8 place-items-center rounded-control text-muted hover:bg-sunken hover:text-fg"
                        aria-label={`Dismiss ${t.name}`}
                        onClick={() => dropTransfer(t.id)}
                      >
                        <X className="size-4" />
                      </button>
                    </span>
                  ) : (
                    <span className="shrink-0 text-[12px] text-muted tabular">{Math.round(t.fraction * 100)}%</span>
                  )}
                </div>
                {t.error ? (
                  <p className="mt-1 text-[13px] text-danger">{t.error}</p>
                ) : (
                  <>
                    <p className="mt-1 text-[12px] text-muted">{PHASE_LABEL[t.phase]}</p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${t.fraction * 100}%` }} />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <Notice
            tone="danger"
            title="Couldn’t load your files"
            action={
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                Try again
              </Button>
            }
          >
            {error}
          </Notice>
        ) : null}

        <Panel
          className={cn('relative', dragging && 'ring-2 ring-accent')}
          onDragOver={(e) => {
            if (trashed || readOnly || !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (trashed || readOnly) return;
            e.preventDefault();
            setDragging(false);
            void uploadFiles(Array.from(e.dataTransfer.files));
          }}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-card bg-accent-soft/80 text-sm font-medium text-accent-text">
              Drop to encrypt and upload
            </div>
          ) : null}
          {view === 'folder' && parent !== undefined && path.length > 0 && !searching ? (
            <button
              type="button"
              onClick={() => go('folder', parent)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left text-sm text-muted hover:bg-sunken/60 hover:text-fg sm:px-5"
            >
              <CornerLeftUp className="size-4" aria-hidden="true" />
              Up to {path.length > 1 ? path[path.length - 2].name : 'My files'}
            </button>
          ) : null}
          {shown === null ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : shown.length === 0 ? (
            <Empty view={view} searching={searching} readOnly={readOnly} onUpload={() => fileInput.current?.click()} onNewFolder={() => setDialog({ kind: 'new-folder' })} />
          ) : (
            <ul className="divide-y divide-line" data-testid="cloud-items" aria-label="Files and folders">
              {shown.map((item) => (
                <Row
                  key={item.row.id}
                  item={item}
                  trashed={trashed}
                  readOnly={readOnly}
                  showLocation={searching}
                  pinTo={space?.name ?? null}
                  onOpen={() => (item.kind === 'folder' ? go('folder', item.row.id) : download(item))}
                  onDownload={() => item.kind === 'file' && download(item)}
                  onRename={() => setDialog({ kind: 'rename', item })}
                  onMove={() => setDialog({ kind: 'move', item })}
                  onFavorite={() => item.kind === 'file' && act(() => cloud.updateFile(item.row.id, { favorite: !item.row.favorite }))}
                  onPin={() =>
                    space && act(() => cloud.pinToSpace(space.id, item.kind === 'file' ? { fileId: item.row.id } : { folderId: item.row.id }), `Pinned to ${space.name}`)
                  }
                  onTrash={() =>
                    act(() => (item.kind === 'file' ? cloud.updateFile(item.row.id, { trashed: true }) : cloud.updateFolder(item.row.id, { trashed: true })), 'Moved to trash')
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
        <p className="text-[12px] text-muted tabular lg:hidden">
          {cloud.formatBytes(usage.used)} of {cloud.formatBytes(usage.quota)} used
        </p>
      </div>

      <NameDialog
        key={dialog?.kind === 'rename' ? `rename-${dialog.item.row.id}` : (dialog?.kind ?? 'closed')}
        open={dialog?.kind === 'new-folder' || dialog?.kind === 'rename'}
        title={dialog?.kind === 'rename' ? 'Rename' : 'New folder'}
        initial={dialog?.kind === 'rename' ? label(dialog.item) : ''}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (!nameKey) return;
          if (dialog?.kind === 'new-folder') await cloud.createFolder(nameKey, keyVersion, folderId, name);
          else if (dialog?.kind === 'rename') {
            const it = dialog.item;
            if (it.kind === 'folder') await cloud.renameFolder(nameKey, keyVersion, it.row.id, name);
            else if (it.meta) await cloud.renameFile(vaultKey, it.row, it.meta, name);
          }
          setDialog(null);
          await refresh();
        }}
      />
      <MoveDialog
        key={dialog?.kind === 'move' ? dialog.item.row.id : 'move-closed'}
        item={dialog?.kind === 'move' ? dialog.item : null}
        loadEverything={loadEverything}
        onClose={() => setDialog(null)}
        onMove={async (item, target) => {
          if (item.kind === 'file') await cloud.updateFile(item.row.id, { folderId: target });
          else await cloud.updateFolder(item.row.id, { parentId: target });
          setDialog(null);
          toast({ tone: 'success', message: 'Moved' });
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

function Empty({
  view,
  searching,
  readOnly,
  onUpload,
  onNewFolder,
}: {
  view: View;
  searching: boolean;
  readOnly: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
}) {
  if (searching) return <EmptyState icon={<Search />} title="No matching files">Search looks at names across all your files and folders, not in the trash.</EmptyState>;
  if (view === 'trash') return <EmptyState icon={<Trash2 />} title="Trash is empty">Items you move to the trash stay here until you restore them or delete them permanently.</EmptyState>;
  if (view === 'favorites') return <EmptyState icon={<Star />} title="No favourites yet">Open a file’s menu and choose “Add to favourites” to keep it here.</EmptyState>;
  if (view === 'recent') return <EmptyState icon={<Clock />} title="Nothing recent">Files you upload or change appear here.</EmptyState>;
  return (
    <EmptyState
      icon={<Folder />}
      title="No files here yet"
      action={
        readOnly ? undefined : (
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={onUpload}>
              <Upload />
              Upload test files
            </Button>
            <Button size="sm" variant="secondary" onClick={onNewFolder}>
              <FolderPlus />
              New folder
            </Button>
          </div>
        )
      }
    >
      Drag files here or use Upload. During the developer preview, use test files only.
    </EmptyState>
  );
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
  readOnly: boolean;
  showLocation: boolean;
  pinTo: string | null;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onFavorite: () => void;
  onPin: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { item, trashed } = props;
  const name = label(item);
  const Icon = item.kind === 'folder' ? Folder : FileIcon;
  const size = item.kind === 'file' ? cloud.formatBytes(item.meta?.size ?? item.row.size_bytes) : 'Folder';
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <button
        type="button"
        onClick={trashed ? undefined : props.onOpen}
        disabled={trashed}
        className="flex min-w-0 flex-1 items-center gap-3 rounded text-left disabled:cursor-default"
        aria-label={trashed ? undefined : item.kind === 'folder' ? `Open folder ${name}` : `Download ${name}`}
      >
        <Icon className={cn('size-5 shrink-0', item.kind === 'folder' ? 'text-accent-text' : 'text-muted')} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-[12px] text-muted tabular">
            {size} · {new Date(item.row.updated_at).toLocaleDateString()}
            {props.showLocation && item.location ? ` · in ${item.location}` : ''}
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
          <M.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-card border border-line bg-raised p-1 shadow-high">
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
                {(item.kind === 'file' && !item.meta) || (item.kind === 'folder' && props.readOnly) ? null : (
                  <MenuItem icon={Pencil} onSelect={props.onRename}>
                    Rename
                  </MenuItem>
                )}
                <MenuItem icon={FolderInput} onSelect={props.onMove}>
                  Move to…
                </MenuItem>
                {props.pinTo ? (
                  <MenuItem icon={Pin} onSelect={props.onPin}>
                    Pin to {props.pinTo}
                  </MenuItem>
                ) : null}
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

/** Folder picker. A folder can't be moved into itself or its own subfolders (the server enforces this too). */
function MoveDialog({
  item,
  loadEverything,
  onClose,
  onMove,
}: {
  item: Item | null;
  loadEverything: () => Promise<{ items: Item[]; folderNames: Map<string, string> } | null>;
  onClose: () => void;
  onMove: (item: Item, target: string | null) => Promise<void>;
}) {
  const [folders, setFolders] = useState<{ id: string; name: string; parent: string | null }[] | null>(null);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    void loadEverything()
      .then((all) =>
        setFolders(
          (all?.items ?? [])
            .filter((i): i is FolderItem => i.kind === 'folder')
            .map((f) => ({ id: f.row.id, name: label(f), parent: f.row.parent_id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch((e) => setError(errMsg(e)));
  }, [item, loadEverything]);

  const blocked = useMemo(() => {
    const set = new Set<string>();
    if (item?.kind !== 'folder' || !folders) return set;
    set.add(item.row.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parent && set.has(f.parent) && !set.has(f.id)) {
          set.add(f.id);
          grew = true;
        }
      }
    }
    return set;
  }, [item, folders]);
  const current = item ? (item.kind === 'file' ? item.row.folder_id : item.row.parent_id) : null;

  return (
    <DialogRoot open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item ? `Move “${label(item)}”` : 'Move'}>
        {folders === null ? (
          error ? <p className="text-[13px] text-danger">{error}</p> : <Skeleton className="h-24 w-full" />
        ) : (
          <fieldset>
            <legend className="sr-only">Destination folder</legend>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {[{ id: null as string | null, name: 'My files (top level)' }, ...folders.filter((f) => !blocked.has(f.id))].map((f) => (
                <li key={f.id ?? 'root'}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 text-sm hover:bg-sunken">
                    <input type="radio" name="move-target" className="size-4" checked={target === f.id} onChange={() => setTarget(f.id)} disabled={f.id === current} />
                    <Folder className="size-4 text-accent-text" aria-hidden="true" />
                    <span className="truncate">{f.name}</span>
                    {f.id === current ? <span className="text-[12px] text-muted">(current)</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {error && folders ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={target === undefined || target === current}
            onClick={async () => {
              if (!item || target === undefined) return;
              setBusy(true);
              setError(null);
              try {
                await onMove(item, target);
              } catch (e) {
                setError(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Move here
          </Button>
        </div>
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
          The encrypted data is removed from OneAuth’s storage now. Database backups may hold the encrypted copy until they expire; it can’t be read
          without your vault key.
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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Link2, Lock, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { DropdownMenu as M } from 'radix-ui';
import { Button, ButtonLink } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/client/api';
import { cn } from '@/lib/cn';
import * as cloud from '@/lib/vault/client';
import { safeName, safeUrl } from '@/lib/vault/names';

export interface UnlockedVault {
  vaultKey: Uint8Array;
  vaultId: string;
  keyVersion: number;
  /** false until this browser has confirmed the key (Cloud page): items are shown but not changed. */
  trusted: boolean;
}

interface Decoded {
  row: cloud.SpaceItemRow;
  title: string;
  url: string | null; // null: the stored link isn't a web address and is never rendered as one
  note?: string;
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
}

/** A link from decrypted (untrusted) data: only http(s) is ever rendered as a link. */
function SafeLink({ item, newTab, className, children }: { item: Decoded; newTab: boolean; className?: string; children: React.ReactNode }) {
  if (!item.url) {
    return (
      <span className={cn(className, 'cursor-not-allowed opacity-70')} title="This link isn’t a web address, so it isn’t opened">
        {children}
      </span>
    );
  }
  return (
    <a href={item.url} className={className} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : { rel: 'noreferrer' })}>
      {children}
    </a>
  );
}

/**
 * Shortcuts and bookmarks for one space. Contents are end-to-end encrypted with
 * a key derived from the vault key; the server stores only ciphertext, kind and order.
 */
export function SpaceItems({
  space,
  vault,
  cloudEnabled,
  tick,
}: {
  space: cloud.Space;
  vault: UnlockedVault | null;
  cloudEnabled: boolean;
  tick: number;
}) {
  const toast = useToast();
  const [data, setData] = useState<{ items: Decoded[]; locked: boolean; lockedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ kind: 'bookmark' | 'shortcut'; item?: Decoded } | null>(null);
  const [spaceKey, setSpaceKey] = useState<CryptoKey | null>(null);
  const newTab = space.prefs?.linksInNewTab ?? true;

  useEffect(() => {
    if (vault) void cloud.spaceKeyFor(vault.vaultKey, vault.vaultId).then(setSpaceKey);
  }, [vault]);

  const load = useCallback(async () => {
    try {
      const res = await cloud.listSpaceItems(space.id);
      if (res.locked || !spaceKey) {
        setData({ items: [], locked: res.locked || !vault, lockedCount: res.lockedCount });
        return;
      }
      const items = await Promise.all(
        res.items.map(async (row): Promise<Decoded> => {
          try {
            const body = await cloud.openSpaceItem<cloud.BookmarkBody & cloud.ShortcutBody>(spaceKey, row);
            return { row, title: safeName(row.kind === 'shortcut' ? body.label : body.title, 'Untitled'), url: safeUrl(body.url), note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined };
          } catch {
            return { row, title: 'Unreadable item', url: null };
          }
        }),
      );
      setData({ items, locked: false, lockedCount: 0 });
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [space.id, spaceKey, vault]);

  useEffect(() => {
    if (vault && !spaceKey) return; // wait for the key
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, tick, vault, spaceKey]);

  const shortcuts = useMemo(() => data?.items.filter((i) => i.row.kind === 'shortcut') ?? [], [data]);
  const bookmarks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.items.filter((i) => i.row.kind === 'bookmark') ?? [];
    return q ? list.filter((b) => b.title.toLowerCase().includes(q) || (b.url ?? '').toLowerCase().includes(q) || (b.note ?? '').toLowerCase().includes(q)) : list;
  }, [data, query]);

  async function remove(item: Decoded) {
    try {
      await cloud.deleteSpaceItem(space.id, item.row.id);
      await load();
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    }
  }

  if (data === null) {
    return (
      <Panel className="p-5">
        {error ? <p className="text-[13px] text-danger">{error}</p> : <Skeleton className="h-16 w-full" />}
      </Panel>
    );
  }

  if (data.locked) {
    return (
      <Panel>
        <PanelHeader title="Shortcuts and bookmarks" />
        <EmptyState
          icon={<Lock />}
          title={data.lockedCount ? `${data.lockedCount} encrypted ${data.lockedCount === 1 ? 'item' : 'items'} in this space` : 'Encrypted shortcuts and bookmarks'}
          action={
            cloudEnabled ? (
              <ButtonLink href="/cloud" variant="secondary" size="sm">
                Unlock in Cloud
              </ButtonLink>
            ) : undefined
          }
        >
          {cloudEnabled
            ? 'They’re end-to-end encrypted. Approve this browser in Cloud (compare the security code on a browser you already use) and they’ll appear here.'
            : 'They’re end-to-end encrypted and need OneAuth Cloud, which isn’t available on this deployment yet.'}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <>
      {vault && !vault.trusted ? (
        <p className="text-[13px] text-muted">
          Confirm this browser on the Cloud page before changing shortcuts or bookmarks here. Until then they’re read-only.
        </p>
      ) : null}
      <Panel>
        <PanelHeader
          title="Shortcuts"
          description="The places you open first, on any approved browser."
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'shortcut' })} disabled={!vault?.trusted}>
              <Plus />
              Add shortcut
            </Button>
          }
        />
        {shortcuts.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted">No shortcuts yet. Add the sites and tools you use most in this space.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4" data-testid="space-shortcuts">
            {shortcuts.map((s) => (
              <li key={s.row.id} className="group relative">
                <SafeLink item={s} newTab={newTab} className="flex h-full flex-col gap-2 rounded-card border border-line p-3 hover:border-line-strong hover:bg-sunken/50">
                  <span className="grid size-9 place-items-center rounded-control bg-accent-soft text-[15px] font-semibold text-accent-text" aria-hidden="true">
                    {s.title.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.title}</span>
                    <span className="block truncate text-[12px] text-muted">{s.url ? hostOf(s.url) : 'Not a web link'}</span>
                  </span>
                </SafeLink>
                {vault?.trusted ? (
                  <ItemMenu name={s.title} onEdit={() => setEditing({ kind: 'shortcut', item: s })} onRemove={() => remove(s)} className="absolute top-2 right-2" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Bookmarks"
          description="Encrypted in this browser; OneAuth can’t see the links."
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'bookmark' })} disabled={!vault?.trusted}>
              <Plus />
              Add bookmark
            </Button>
          }
        />
        {data.items.some((i) => i.row.kind === 'bookmark') ? (
          <div className="border-b border-line px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <label htmlFor="bookmark-search" className="sr-only">
                Search bookmarks
              </label>
              <Input id="bookmark-search" type="search" className="h-10 pl-9" placeholder="Search bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        ) : null}
        {bookmarks.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted">{query ? 'No bookmarks match.' : 'No bookmarks yet.'}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="space-bookmarks">
            {bookmarks.map((b) => (
              <li key={b.row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <Bookmark className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <SafeLink item={b} newTab={newTab} className="min-w-0 flex-1 rounded">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {b.title}
                    {b.url && newTab ? <ExternalLink className="size-3 shrink-0 text-subtle" aria-label="(opens in a new tab)" /> : null}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{b.note ? `${b.note} · ` : ''}{b.url ? hostOf(b.url) : 'Not a web link'}</span>
                </SafeLink>
                {vault?.trusted ? <ItemMenu name={b.title} onEdit={() => setEditing({ kind: 'bookmark', item: b })} onRemove={() => remove(b)} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && vault?.trusted && spaceKey ? (
        <ItemDialog
          key={editing.item?.row.id ?? `new-${editing.kind}`}
          kind={editing.kind}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              if (editing.item) await cloud.updateSpaceItem(spaceKey, vault.keyVersion, space.id, editing.item.row, body);
              else await cloud.createSpaceItem(spaceKey, vault.keyVersion, space.id, editing.kind, body);
            } catch (e) {
              // Edited on another browser meanwhile: show the latest version rather than overwrite it.
              if (e instanceof ApiError && e.code === 'conflict') {
                setEditing(null);
                toast({ tone: 'error', message: e.message });
                await load();
                return;
              }
              throw e;
            }
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function ItemMenu({ name, onEdit, onRemove, className }: { name: string; onEdit: () => void; onRemove: () => void; className?: string }) {
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          className={cn('grid size-8 shrink-0 place-items-center rounded-control bg-surface/80 text-muted hover:bg-sunken hover:text-fg', className)}
          aria-label={`Actions for ${name}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-card border border-line bg-raised p-1 shadow-high">
          <M.Item onSelect={onEdit} className="flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </M.Item>
          <M.Item onSelect={onRemove} className="flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-danger outline-none data-[highlighted]:bg-sunken">
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

function ItemDialog({
  kind,
  item,
  onClose,
  onSave,
}: {
  kind: 'bookmark' | 'shortcut';
  item?: Decoded;
  onClose: () => void;
  onSave: (body: cloud.BookmarkBody | cloud.ShortcutBody) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // People type "example.com"; accept it as https, but nothing other than a web address.
  const normalised = safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  const urlInvalid = url.trim().length > 0 && !normalised;
  const valid = title.trim().length > 0 && title.trim().length <= 120 && normalised !== null;

  return (
    <DialogRoot open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${item ? 'Edit' : 'Add'} ${kind}`}
        description="Encrypted in this browser before it’s saved. Your other approved browsers see it on their next refresh."
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || !normalised) return;
            setBusy(true);
            setError(null);
            try {
              await onSave(kind === 'shortcut' ? { label: title.trim(), url: normalised } : { title: title.trim(), url: normalised, ...(note.trim() ? { note: note.trim() } : {}) });
            } catch (err) {
              setError(errMsg(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="item-title" className="text-sm font-medium">
              {kind === 'shortcut' ? 'Label' : 'Title'}
            </label>
            <Input id="item-title" className="mt-1.5" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label htmlFor="item-url" className="text-sm font-medium">
              Web address
            </label>
            <Input
              id="item-url"
              className="mt-1.5"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlInvalid}
              aria-describedby="item-url-hint"
            />
            <p id="item-url-hint" className={cn('mt-1.5 text-[12px]', urlInvalid ? 'text-danger' : 'text-muted')}>
              {urlInvalid ? 'Only web addresses (http or https) can be saved.' : (
                <span className="flex items-center gap-1">
                  <Link2 className="size-3" aria-hidden="true" />
                  Links open the site; OneAuth doesn’t sign in to it for you.
                </span>
              )}
            </p>
          </div>
          {kind === 'bookmark' ? (
            <div>
              <label htmlFor="item-note" className="text-sm font-medium">
                Note <span className="font-normal text-muted">(optional)</span>
              </label>
              <Input id="item-note" className="mt-1.5" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          ) : null}
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!valid}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

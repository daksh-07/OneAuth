'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/client/api';
import * as cloud from '@/lib/vault/client';

/**
 * After a vault-key replacement, files whose contents were encrypted earlier
 * can still be read by a removed browser that kept their file keys, if it ever
 * obtained the encrypted data. Re-encrypting them (deep rotation) closes that.
 * Each file is swapped only after its new copy is verified; stopping part-way
 * is safe, and the count shown is what's left (docs/cloud/key-rotation.md §7).
 */
export function ReencryptExisting({ vaultKey, keyVersion, tick, onDone }: { vaultKey: Uint8Array; keyVersion: number; tick: number; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<cloud.FileRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFiles((await cloud.listStaleContent()).files);
    } catch {
      setFiles([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, tick, keyVersion]);

  if (!files?.length) return null;
  const bytes = files.reduce((n, f) => n + f.size_bytes, 0);

  async function run() {
    if (!files) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    let done = 0;
    let failed = 0;
    for (const f of files) {
      try {
        await cloud.reencryptFile(vaultKey, keyVersion, f);
      } catch (e) {
        failed++;
        if (e instanceof ApiError && e.code === 'quota_exceeded') {
          setError('There isn’t enough free storage to re-encrypt the next file (each needs room for a second copy briefly). Free some space and continue.');
          break;
        }
      }
      setProgress({ done: ++done, total: files.length });
    }
    setProgress(null);
    if (failed) setError((prev) => prev ?? `${failed} ${failed === 1 ? 'file' : 'files'} couldn’t be re-encrypted this time. You can try again.`);
    else toast({ tone: 'success', message: 'Existing files re-encrypted under your current key' });
    await load();
    onDone();
  }

  return (
    <Notice
      tone="info"
      title={`${files.length} ${files.length === 1 ? 'file was' : 'files were'} encrypted before your last key replacement`}
      action={
        <Button size="sm" onClick={run} loading={progress !== null} disabled={progress !== null}>
          Re-encrypt {files.length === 1 ? 'it' : 'them'} now ({cloud.formatBytes(bytes)})
        </Button>
      }
    >
      <span className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          A browser you removed may have kept the keys to these. It can’t get them from OneAuth any more, but re-encrypting closes the remaining
          risk if the encrypted data ever leaked. Each file is downloaded, re-encrypted with a new key in this browser and replaced only once the
          new copy is verified.
        </span>
      </span>
      {progress ? (
        <span className="mt-2 block tabular" aria-live="polite">
          {progress.done} of {progress.total} re-encrypted…
        </span>
      ) : null}
      {error ? <span className="mt-2 block text-danger">{error}</span> : null}
    </Notice>
  );
}

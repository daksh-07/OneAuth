'use client';

import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';

const CHECK_GROUP = 4; // users confirm the 5th group

/**
 * Shows a recovery key once and requires proof it was saved before continuing.
 * Used for vault setup and for key replacement (which always issues a new key).
 */
export function RecoveryKeyStep({
  display,
  confirmLabel,
  busy,
  error,
  note,
  onConfirm,
  onCancel,
}: {
  display: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  note?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const groups = display.split('-');
  const checkOk = check.trim().toUpperCase() === groups[CHECK_GROUP];

  function download() {
    const text =
      `OneAuth Cloud recovery key\n\n${display}\n\n` +
      `This key can unlock your encrypted files if you lose access to all of your approved browsers.\n` +
      `OneAuth can't recover it for you. Keep it somewhere safe and private, such as a password manager.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oneauth-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Copying isn’t available here. Download the key or write it down instead.');
    }
  }

  return (
    <div>
      <ol
        className="mt-5 grid grid-cols-3 gap-2 rounded-card border border-line bg-sunken p-4 font-mono text-[15px] tracking-wider sm:grid-cols-5"
        aria-label="Recovery key, in groups of four characters"
      >
        {groups.map((g, i) => (
          <li key={i} className="flex items-baseline gap-1.5">
            <span className="w-4 text-right font-sans text-[11px] text-muted" aria-hidden="true">
              {i + 1}
            </span>
            <span className={i === groups.length - 1 ? 'text-muted' : undefined}>{g}</span>
          </li>
        ))}
      </ol>
      <p className="sr-only" data-testid="recovery-key">
        {display}
      </p>
      <p className="mt-2 text-[12px] text-muted">The last group is a checksum that catches typing mistakes.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          <Copy />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download />
          Download as text file
        </Button>
      </div>
      {copyError ? <p className="mt-2 text-[13px] text-danger">{copyError}</p> : null}

      <details className="mt-4 rounded-card border border-line px-4 py-3 text-[13px] leading-relaxed text-muted">
        <summary className="cursor-pointer font-medium text-fg">Where should I keep it?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>A password manager entry that isn’t protected only by this OneAuth account.</li>
          <li>Or printed and kept with your important documents.</li>
          <li>Not in an email to yourself, a photo, or a note synced to a shared account.</li>
        </ul>
      </details>

      <label className="mt-6 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my recovery key somewhere safe.
      </label>
      {saved ? (
        <div className="mt-4 max-w-xs">
          <label htmlFor="rk-check" className="text-sm font-medium">
            To confirm, type group {CHECK_GROUP + 1} of your key
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
            aria-describedby={check.length === 4 && !checkOk ? 'rk-check-error' : undefined}
          />
          {check.length === 4 && !checkOk ? (
            <p id="rk-check-error" className="mt-1.5 text-[13px] text-danger">
              That doesn’t match. Check the key you saved.
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <Notice tone="danger" title="That didn’t work" className="mt-5">
          {error}
        </Notice>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={!saved || !checkOk} loading={busy}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {note ? <p className="mt-3 text-[13px] text-muted">{note}</p> : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

/**
 * Shown when this browser received a vault key it couldn't verify by itself:
 * just after being approved, or after a key replacement it couldn't check
 * with a transition proof. Until the user confirms, this browser doesn't
 * write anything under that key. See docs/cloud/key-rotation.md §3a.
 */
export function ConfirmThisBrowser({ code, onMatch, onMismatch }: { code: string | null; onMatch: () => Promise<void>; onMismatch: () => Promise<void> }) {
  const [busy, setBusy] = useState<'match' | 'mismatch' | null>(null);
  return (
    <Notice
      tone="warning"
      title="Check this browser’s confirmation code"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!code || busy !== null}
            loading={busy === 'match'}
            onClick={async () => {
              setBusy('match');
              await onMatch().finally(() => setBusy(null));
            }}
          >
            Codes match
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            loading={busy === 'mismatch'}
            onClick={async () => {
              setBusy('mismatch');
              await onMismatch().finally(() => setBusy(null));
            }}
          >
            They don’t match
          </Button>
        </div>
      }
    >
      <span className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          On a browser that already had access, open Cloud and choose <strong>Code</strong> next to this browser. It should show:
        </span>
      </span>
      <span className="mt-2 block font-mono text-2xl font-semibold tracking-[0.15em] text-fg" data-testid="confirmation-code">
        {code ?? '…'}
      </span>
      <span className="mt-2 block">
        Until you confirm, this browser can open your files but won’t upload or change anything. If the codes differ, the key it received may not be
        yours: choose “They don’t match” and this browser’s access is removed.
      </span>
    </Notice>
  );
}

'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RelativeTime } from '@/components/ui/time';
import { useToast } from '@/components/ui/toast';
import { revokeSessionAction } from '@/lib/server/actions';

interface Row {
  id: string;
  deviceName: string;
  kind: 'primary' | 'paired';
  lastSeen: string;
  expiresAt: string;
}

export function SessionList({ sessions, currentId, canRevoke }: { sessions: Row[]; currentId: string; canRevoke: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function revoke(id: string) {
    setBusy(id);
    start(async () => {
      const res = await revokeSessionAction(id);
      setBusy(null);
      toast(res.ok ? { tone: 'success', message: 'Session ended' } : { tone: 'error', message: res.message });
      router.refresh();
    });
  }

  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {s.deviceName}
              {s.id === currentId ? <Badge tone="accent">This session</Badge> : null}
              <Badge>{s.kind === 'primary' ? 'Passkey sign-in' : 'Approved from another device'}</Badge>
            </p>
            <p className="text-[12px] text-muted">
              Active <RelativeTime value={s.lastSeen} /> · ends <RelativeTime value={s.expiresAt} />
            </p>
          </div>
          {canRevoke && s.id !== currentId ? (
            <Button variant="secondary" size="sm" onClick={() => revoke(s.id)} loading={busy === s.id}>
              End
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

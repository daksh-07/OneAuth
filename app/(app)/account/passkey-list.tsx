'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { RelativeTime } from '@/components/ui/time';
import { useToast } from '@/components/ui/toast';
import { removePasskeyAction } from '@/lib/server/actions';
import { actionWithStepUp, isCancellation, passkeyErrorMessage, registerPasskey, withStepUp } from '@/lib/client/api';

interface Passkey {
  id: string;
  nickname: string;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

export function PasskeyList({ passkeys }: { passkeys: Passkey[] }) {
  const router = useRouter();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await withStepUp(() => registerPasskey('/api/auth/passkeys', {}, { nickname }));
      setAddOpen(false);
      setNickname('');
      toast({ tone: 'success', message: 'Passkey added' });
      router.refresh();
    } catch (err) {
      setAddError(isCancellation(err) ? 'Cancelled.' : passkeyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  function remove() {
    if (!removing) return;
    setRemoveError(null);
    start(async () => {
      try {
        const res = await actionWithStepUp(() => removePasskeyAction(removing.id));
        if (!res.ok) return setRemoveError(res.message);
        setRemoving(null);
        toast({ tone: 'success', message: 'Passkey removed' });
        router.refresh();
      } catch (err) {
        setRemoveError(isCancellation(err) ? 'Cancelled.' : passkeyErrorMessage(err));
      }
    });
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {passkeys.map((p) => (
          <li key={p.id} className="flex items-center gap-3.5 px-5 py-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sunken">
              <KeyRound className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {p.nickname}
                {p.backed_up ? <Badge tone="success">Synced</Badge> : <Badge>This device only</Badge>}
              </p>
              <p className="text-[12px] text-muted">
                Added <RelativeTime value={p.created_at} />
                {p.last_used_at ? (
                  <>
                    {' · '}last used <RelativeTime value={p.last_used_at} />
                  </>
                ) : null}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${p.nickname}`}
              disabled={passkeys.length <= 1}
              title={passkeys.length <= 1 ? 'Add another passkey before removing this one' : undefined}
              onClick={() => {
                setRemoveError(null);
                setRemoving(p);
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-4">
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus />
          Add a passkey
        </Button>
      </div>

      <DialogRoot open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          title="Add a passkey"
          description="You’ll confirm it’s you, then create a new passkey on this device, a phone nearby, or a security key."
        >
          <form onSubmit={add} className="space-y-4">
            <Field label="Name" hint="For example “Work laptop” or “YubiKey”." error={addError}>
              {(p) => <Input {...p} value={nickname} maxLength={48} onChange={(e) => setNickname(e.target.value)} placeholder="Passkey" />}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={adding}>
                Continue
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>

      <DialogRoot open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent
          title={`Remove “${removing?.nickname ?? ''}”?`}
          description="You won’t be able to sign in with it any more. Also delete it from your device’s password manager to tidy up."
        >
          {removeError ? (
            <p className="mb-4 text-sm text-danger" role="alert">
              {removeError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="danger" onClick={remove} loading={pending}>
              Remove passkey
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { deleteAccountAction } from '@/lib/server/actions';
import { actionWithStepUp, isCancellation, passkeyErrorMessage } from '@/lib/client/api';

export function DeleteAccount() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-danger">Delete account</p>
        <p className="text-[13px] text-muted">Permanently removes your identity, devices, sessions and history.</p>
      </div>
      <DialogRoot>
        <DialogTrigger asChild>
          <Button variant="secondary" className="text-danger">
            Delete account
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Delete your OneAuth account?"
          description="This can’t be undone. Every connected device is signed out, and your passkey records and security history are deleted."
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                try {
                  const res = await actionWithStepUp(() => deleteAccountAction(confirm));
                  if (res && !res.ok) setError(res.message);
                } catch (err) {
                  setError(isCancellation(err) ? 'Cancelled.' : passkeyErrorMessage(err));
                }
              });
            }}
          >
            <Field label="Type “delete my account” to confirm" error={error}>
              {(p) => <Input {...p} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="danger" loading={pending} disabled={confirm.trim().toLowerCase() !== 'delete my account'}>
                Delete permanently
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { updateNameAction } from '@/lib/server/actions';

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateNameAction(value);
          if (!res.ok) return setError(res.message);
          setError(null);
          toast({ tone: 'success', message: 'Name updated' });
          router.refresh();
        });
      }}
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Display name" error={error}>
            {(p) => <Input {...p} value={value} maxLength={64} autoComplete="name" onChange={(e) => setValue(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" variant="secondary" className="h-11" loading={pending} disabled={value.trim() === name || !value.trim()}>
          Save
        </Button>
      </div>
      <p className="mt-1.5 text-[13px] text-muted">Passkeys already saved on your devices keep the name they were created with.</p>
    </form>
  );
}

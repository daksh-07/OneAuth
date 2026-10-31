'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { renameDeviceAction } from '@/lib/server/actions';

export function RenameDeviceForm({ deviceId, name }: { deviceId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await renameDeviceAction(deviceId, value);
          if (!res.ok) return setError(res.message);
          setError(null);
          toast({ tone: 'success', message: 'Device renamed' });
          router.refresh();
        });
      }}
      className="flex items-end gap-2"
    >
      <div className="flex-1">
        <Field label="Device name" error={error}>
          {(p) => <Input {...p} value={value} maxLength={64} onChange={(e) => setValue(e.target.value)} />}
        </Field>
      </div>
      <Button type="submit" variant="secondary" className="h-11" loading={pending} disabled={value.trim() === name}>
        Save
      </Button>
    </form>
  );
}

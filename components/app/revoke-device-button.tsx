'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { revokeDeviceAction } from '@/lib/server/actions';

export function RevokeDeviceButton({ deviceId, name, isCurrent, size = 'sm' }: { deviceId: string; name: string; isCurrent: boolean; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const res = await revokeDeviceAction(deviceId);
      if (!res.ok) return setError(res.message);
      setOpen(false);
      if (isCurrent) {
        router.replace('/signin');
        router.refresh();
        return;
      }
      toast({ tone: 'success', message: `${name} was disconnected` });
      router.push('/devices');
      router.refresh();
    });
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size={size} className="text-danger">
          <Unplug />
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent title={`Disconnect ${name}?`}>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Every OneAuth session on this device ends immediately, whether or not it’s online.</li>
          <li>To reconnect, it will need to be approved again.</li>
          <li>Anything it has already downloaded or displayed can’t be removed remotely.</li>
          {isCurrent ? <li className="font-medium text-fg">This is the device you’re using, so you’ll be signed out.</li> : null}
        </ul>
        {error ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="danger" onClick={confirm} loading={pending}>
            Disconnect device
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

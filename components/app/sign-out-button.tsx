'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/client/api';
import { useToast } from '@/components/ui/toast';

export function SignOutButton({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      await postJson('/api/auth/signout');
      router.replace('/');
      router.refresh();
    } catch {
      toast({ tone: 'error', message: 'Couldn’t sign out. Check your connection and try again.' });
      setPending(false);
    }
  }
  return compact ? (
    <Button variant="ghost" size="sm" onClick={signOut} loading={pending} aria-label="Sign out" title="Sign out" className="px-2">
      {!pending ? <LogOut /> : null}
    </Button>
  ) : (
    <Button variant="secondary" onClick={signOut} loading={pending}>
      {!pending ? <LogOut /> : null}
      Sign out of this device
    </Button>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { findPairingByCodeAction } from '@/lib/server/actions';

export function CodeEntry() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await findPairingByCodeAction(code);
          if (!res.ok || !res.id) return setError(res.ok ? 'No matching request.' : res.message);
          router.push(`/pair/${res.id}?code=${encodeURIComponent(code)}`);
        });
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Field label="Code on the other device" hint="8 characters, for example K7QM-4PXA." error={error}>
          {(p) => (
            <Input
              {...p}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              className="font-mono text-[17px] tracking-[0.12em]"
            />
          )}
        </Field>
      </div>
      <Button type="submit" className="h-11" loading={pending} disabled={code.replace(/[^0-9A-Z]/gi, '').length !== 8}>
        Continue
      </Button>
    </form>
  );
}

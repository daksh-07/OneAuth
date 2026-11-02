'use client';

import { Button } from '@/components/ui/button';
import { Mark } from '@/components/brand/logo';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center px-4 text-center">
      <div>
        <Mark className="mx-auto size-10 text-muted" />
        <h1 className="mt-6 text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-muted">OneAuth couldn’t load this page. Your account and devices haven’t been changed.</p>
        <Button variant="secondary" className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}

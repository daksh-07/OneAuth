import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { getSession } from '@/lib/server/auth';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(() => null);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="OneAuth home" className="rounded-control">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <Link href="/how-it-works" className="hidden rounded-control px-3 py-2 text-sm text-muted hover:text-fg sm:block">
              How it works
            </Link>
            {session ? (
              <ButtonLink href="/home" size="sm">
                Open OneAuth
              </ButtonLink>
            ) : (
              <>
                <Link href="/signin" className="rounded-control px-3 py-2 text-sm text-muted hover:text-fg">
                  Sign in
                </Link>
                <ButtonLink href="/signup" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Wordmark className="scale-90 opacity-80" />
            <span>Early preview. Not yet ready for sensitive data.</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 [&_a]:inline-flex [&_a]:min-h-8 [&_a]:items-center">
            <Link href="/how-it-works" className="hover:text-fg">
              Security model
            </Link>
            <Link href="/connect" className="hover:text-fg">
              Connect this device
            </Link>
            <Link href="/signin" className="hover:text-fg">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

import { ButtonLink } from '@/components/ui/button';
import { Mark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center px-4 text-center">
      <div>
        <Mark className="mx-auto size-10 text-muted" />
        <h1 className="mt-6 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-muted">It may have moved, or you may not have access to it from this device.</p>
        <ButtonLink href="/" variant="secondary" className="mt-6">
          Go home
        </ButtonLink>
      </div>
    </main>
  );
}

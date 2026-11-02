import { cn } from '@/lib/cn';

/**
 * The OneAuth mark: an identity node inside an open trust ring, with one
 * connected device node sitting in the opening — access that is granted
 * through a deliberate gap, not a closed lock.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path
        d="M25.97 11.35 A11 11 0 1 1 20.65 6.03"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.6" fill="var(--accent)" />
      <circle cx="23.78" cy="8.22" r="2.7" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-fg', className)}>
      <Mark />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">OneAuth</span>
    </span>
  );
}

'use client';

import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DialogRoot = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/**
 * Centered dialog on desktop, bottom sheet on small screens.
 */
export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-up_200ms_ease-out]" />
      <D.Content
        className={cn(
          'fixed z-50 w-full border border-line bg-raised shadow-high focus:outline-none',
          'inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel sm:p-6',
          'data-[state=open]:animate-scale-in',
          className,
        )}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
          <D.Close className="-mt-1 -mr-1 grid size-8 place-items-center rounded-control text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {description ? <D.Description className="mt-1.5 text-sm leading-relaxed text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

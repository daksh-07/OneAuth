'use client';

import { useTransition } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { setThemeAction } from '@/lib/server/actions';

const OPTIONS = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
] as const;

export function ThemePicker({ current }: { current: string }) {
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-control border border-line bg-sunken p-1" aria-busy={pending || undefined}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={current === o.id}
          onClick={() => start(() => setThemeAction(o.id))}
          className={cn(
            'flex h-8 items-center gap-2 rounded-[6px] px-3 text-[13px] transition-colors',
            current === o.id ? 'bg-surface font-medium text-fg shadow-low' : 'text-muted hover:text-fg',
          )}
        >
          <o.icon className="size-4" aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

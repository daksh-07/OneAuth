'use client';

import { useEffect, useSyncExternalStore } from 'react';

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function formatRelative(date: Date, now = Date.now()): string {
  const diff = (date.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? 'just now' : 'in a few seconds';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let size = 60;
  for (const [u, s] of units) if (abs >= s) [unit, size] = [u, s];
  const value = Math.round(diff / size);
  return rtf ? rtf.format(value, unit) : `${value} ${unit}s`;
}

// Server-rendered placeholder of similar width to a relative time, to avoid layout shift on hydration.
const SHORT_DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// One shared ticking clock for every timestamp on the page.
const listeners = new Set<() => void>();
let now = typeof window === 'undefined' ? 0 : Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time on the client (ticks every second); null during server render and hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => now, () => null);
}

/** Relative timestamp rendered in the viewer's locale, with the exact time on hover. */
export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const current = useNow();
  const iso = date.toISOString();
  return (
    <time dateTime={iso} title={current ? date.toLocaleString() : iso} className={className} suppressHydrationWarning>
      {current ? formatRelative(date, current) : SHORT_DATE.format(date)}
    </time>
  );
}

/** Live countdown to an expiry time. */
export function Countdown({ until, onExpire, className }: { until: string | Date; onExpire?: () => void; className?: string }) {
  const target = (typeof until === 'string' ? new Date(until) : until).getTime();
  const current = useNow();
  const left = current === null ? null : Math.max(0, target - current);
  const expired = left === 0;
  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);
  if (left === null) return <span className={className}>–:––</span>;
  const total = Math.floor(left / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const text = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
  return (
    <span className={className} role="timer" aria-live="off">
      {text}
    </span>
  );
}

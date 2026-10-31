'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cloud, House, LayoutGrid, MonitorSmartphone, Plus, ShieldCheck } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { Countdown } from '@/components/ui/time';
import { SignOutButton } from './sign-out-button';
import { cn } from '@/lib/cn';

export interface ShellProps {
  displayName: string;
  deviceName: string;
  restricted: boolean;
  canManageDevices: boolean;
  canSeeDevices: boolean;
  expiresAt: string;
  children: React.ReactNode;
}

const NAV = [
  { href: '/home', label: 'Home', icon: House, needs: null },
  { href: '/space', label: 'My Space', icon: LayoutGrid, needs: null },
  { href: '/devices', label: 'Devices', icon: MonitorSmartphone, needs: 'devices' },
  { href: '/cloud', label: 'Cloud', icon: Cloud, needs: null },
  { href: '/account', label: 'Account & Security', short: 'Account', icon: ShieldCheck, needs: null },
] as const;

export function AppShell({ displayName, deviceName, restricted, canManageDevices, canSeeDevices, expiresAt, children }: ShellProps) {
  const pathname = usePathname();
  const items = NAV.filter((i) => i.needs !== 'devices' || canSeeDevices);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/home" aria-label="OneAuth home" className="rounded-control">
            <Wordmark />
          </Link>
        </div>
        {canManageDevices ? (
          <div className="px-3 pb-3">
            <ButtonLink href="/devices/connect" className="w-full">
              <Plus />
              Connect a device
            </ButtonLink>
          </div>
        ) : null}
        <nav aria-label="Primary" className="flex-1 space-y-0.5 px-3">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={isActive(i.href) ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-3 rounded-control px-3 text-sm transition-colors',
                isActive(i.href) ? 'bg-sunken font-medium text-fg' : 'text-muted hover:bg-sunken/60 hover:text-fg',
              )}
            >
              <i.icon className="size-[18px]" aria-hidden="true" />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-control px-2 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text" aria-hidden="true">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-[12px] text-muted">{deviceName}</p>
            </div>
            <SignOutButton compact />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-md lg:hidden">
          <Link href="/home" aria-label="OneAuth home" className="rounded-control">
            <Wordmark />
          </Link>
          <SignOutButton compact />
        </header>

        {restricted ? (
          <div className="border-b border-warning/20 bg-warning-soft px-4 py-2.5 text-[13px] sm:px-8">
            <span className="font-medium text-fg">Temporary access on this device.</span>{' '}
            <span className="text-muted">
              Ends in <Countdown until={expiresAt} className="font-medium text-fg tabular" />. Sign out when you’re done.
            </span>
          </div>
        ) : null}

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-8 sm:pt-10 lg:pb-16">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around px-2">
          {items.slice(0, 2).map((i) => (
            <MobileItem key={i.href} href={i.href} label={'short' in i ? i.short : i.label} icon={i.icon} active={isActive(i.href)} />
          ))}
          {canManageDevices ? (
            <li className="flex items-center">
              <Link
                href="/devices/connect"
                aria-label="Connect a device"
                className="grid size-12 -translate-y-3 place-items-center rounded-full bg-accent text-accent-fg shadow-high ring-4 ring-canvas transition-transform active:scale-95"
              >
                <Plus className="size-6" aria-hidden="true" />
              </Link>
            </li>
          ) : null}
          {items.slice(2).map((i) => (
            <MobileItem key={i.href} href={i.href} label={'short' in i ? i.short : i.label} icon={i.icon} active={isActive(i.href)} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

function MobileItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof House; active: boolean }) {
  return (
    <li className="flex">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn('flex w-16 flex-col items-center justify-center gap-1 text-[11px]', active ? 'font-medium text-fg' : 'text-muted')}
      >
        <Icon className={cn('size-5', active && 'text-accent')} aria-hidden="true" />
        {label}
      </Link>
    </li>
  );
}

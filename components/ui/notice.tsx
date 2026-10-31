import type { ReactNode } from 'react';
import { CircleAlert, Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

const styles = {
  info: { box: 'bg-accent-soft border-transparent', icon: 'text-accent-text', Icon: Info },
  success: { box: 'bg-success-soft border-transparent', icon: 'text-success', Icon: ShieldCheck },
  warning: { box: 'bg-warning-soft border-transparent', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'bg-danger-soft border-transparent', icon: 'text-danger', Icon: CircleAlert },
} as const;

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof styles;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const s = styles[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex gap-3 rounded-card border p-4', s.box, className)}>
      <s.Icon className={cn('mt-0.5 size-[18px] shrink-0', s.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {children ? <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

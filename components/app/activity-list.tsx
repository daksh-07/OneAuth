import { RelativeTime } from '@/components/ui/time';
import { eventLabel, eventTone } from '@/lib/event-labels';
import type { SecurityEventRow } from '@/lib/server/events';
import { cn } from '@/lib/cn';

const dot = { neutral: 'bg-line-strong', warning: 'bg-warning', danger: 'bg-danger', success: 'bg-success' };

export function ActivityList({ events }: { events: SecurityEventRow[] }) {
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-5 py-3">
          <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot[eventTone(e.type, e.detail)])} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{eventLabel(e.type, e.detail)}</p>
            <p className="truncate text-[12px] text-muted">{e.device_name ?? 'Unknown device'}</p>
          </div>
          <RelativeTime value={e.created_at} className="shrink-0 text-[12px] text-muted tabular" />
        </li>
      ))}
    </ol>
  );
}

import { Laptop, Smartphone, Tv } from 'lucide-react';
import { Mark } from './logo';

/**
 * Illustrative diagram of the OneAuth model: one identity, a phone that
 * approves, an owned laptop, and a temporary guest screen. Not live data.
 */
export function TrustGraph() {
  return (
    <figure className="relative mx-auto aspect-[5/4] w-full max-w-[520px]" aria-labelledby="trust-graph-caption">
      <svg viewBox="0 0 500 400" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <radialGradient id="tg-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="250" cy="200" r="150" fill="url(#tg-glow)" />
        <circle cx="250" cy="200" r="118" fill="none" stroke="var(--line)" strokeDasharray="2 6" />
        <circle cx="250" cy="200" r="74" fill="none" stroke="var(--line)" />
        {/* phone → identity: approver */}
        <line x1="250" y1="200" x2="88" y2="300" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.7" />
        {/* laptop → identity: owned */}
        <line x1="250" y1="200" x2="404" y2="96" stroke="var(--fg-muted)" strokeWidth="1.5" strokeOpacity="0.55" />
        {/* tv → identity: temporary */}
        <line
          x1="250"
          y1="200"
          x2="410"
          y2="318"
          stroke="var(--warning)"
          strokeWidth="1.5"
          strokeDasharray="4 8"
          className="animate-dash"
        />
      </svg>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent/20" aria-hidden="true" />
        <div className="relative grid size-20 place-items-center rounded-full border border-line bg-surface shadow-mid">
          <Mark className="size-10" />
        </div>
      </div>

      {/* Outer nodes are anchored to the figure edges so they never clip on narrow screens. */}
      <Node className="top-[75%] left-0 sm:left-[2%]" icon={<Smartphone />} title="Your phone" meta="Approves with Face ID" tone="accent" />
      <Node className="top-[24%] right-0 sm:right-[2%]" icon={<Laptop />} title="Work laptop" meta="Owned · 30 days" tone="neutral" />
      <Node className="top-[91%] right-0 sm:top-[76%] sm:right-[2%]" icon={<Tv />} title="Guest screen" meta="Temporary · 1 h left" tone="warning" />

      <figcaption id="trust-graph-caption" className="sr-only">
        Illustration: one OneAuth identity connected to a phone that approves access, an owned laptop with 30-day access, and a
        temporary guest screen whose access expires in an hour.
      </figcaption>
    </figure>
  );
}

function Node({
  className,
  icon,
  title,
  meta,
  tone,
}: {
  className: string;
  icon: React.ReactNode;
  title: string;
  meta: string;
  tone: 'accent' | 'neutral' | 'warning';
}) {
  const dot = { accent: 'bg-accent', neutral: 'bg-success', warning: 'bg-warning' }[tone];
  return (
    <div className={`absolute ${className} -translate-y-1/2`} aria-hidden="true">
      <div className="flex items-center gap-2.5 rounded-[12px] border border-line bg-surface py-2 pr-3.5 pl-2 shadow-mid sm:gap-3">
        <div className="grid size-8 place-items-center rounded-[9px] bg-sunken text-fg [&_svg]:size-4">{icon}</div>
        <div className="leading-tight">
          <p className="text-[12px] font-medium whitespace-nowrap text-fg sm:text-[13px]">{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted">
            <span className={`size-1.5 rounded-full ${dot}`} />
            {meta}
          </p>
        </div>
      </div>
    </div>
  );
}

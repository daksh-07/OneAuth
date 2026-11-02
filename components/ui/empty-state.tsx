import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full border border-line bg-sunken text-muted [&_svg]:size-5">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

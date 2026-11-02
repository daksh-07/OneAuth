'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId++;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-md animate-fade-up items-center gap-2.5 rounded-full border border-line bg-raised py-2.5 pr-4 pl-3 text-sm shadow-high',
            )}
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-4 text-danger" aria-hidden="true" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

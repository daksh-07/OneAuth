'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { CheckCircle2, RefreshCw, ShieldX, Smartphone, TimerOff } from 'lucide-react';
import { Button, Spinner } from '@/components/ui/button';
import { Countdown } from '@/components/ui/time';
import { Mark } from '@/components/brand/logo';
import { ApiError, postJson } from '@/lib/client/api';

type Phase =
  | { name: 'creating' }
  | { name: 'waiting'; id: string; code: string; expiresAt: string; qr: string; approveUrl: string }
  | { name: 'claiming' }
  | { name: 'connected' }
  | { name: 'rejected' }
  | { name: 'expired' }
  | { name: 'error'; message: string };

export function ConnectFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: 'creating' });

  const claim = useCallback(async () => {
    setPhase({ name: 'claiming' });
    try {
      await postJson('/api/pairing/claim');
      setPhase({ name: 'connected' });
      setTimeout(() => {
        router.replace('/home');
        router.refresh();
      }, 1200);
    } catch (err) {
      setPhase({ name: 'error', message: err instanceof ApiError ? err.message : 'Could not finish connecting.' });
    }
  }, [router]);

  const start = useCallback(async () => {
    setPhase({ name: 'creating' });
    try {
      const req = await postJson<{ id: string; code: string; expiresAt: string; approveUrl: string }>('/api/pairing/request');
      const qr = await QRCode.toString(req.approveUrl, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#101828', light: '#ffffff' },
      });
      setPhase({ name: 'waiting', ...req, qr });
    } catch (err) {
      setPhase({ name: 'error', message: err instanceof ApiError ? err.message : 'Could not create a connection request.' });
    }
  }, []);

  // Create the first request on mount.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = setTimeout(start, 0);
    return () => clearTimeout(t);
  }, [start]);

  // Poll while waiting for approval. The server is the only source of truth for the outcome.
  const waitingId = phase.name === 'waiting' ? phase.id : null;
  useEffect(() => {
    if (!waitingId) return;
    let cancelled = false;
    let inFlight = false;
    const t = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { status } = await postJson<{ status: string }>('/api/pairing/status');
        if (cancelled) return;
        if (status === 'approved') {
          cancelled = true;
          clearInterval(t);
          void claim();
        } else if (status === 'rejected') setPhase({ name: 'rejected' });
        else if (status !== 'pending') setPhase({ name: 'expired' });
      } catch {
        // Transient network failure: keep waiting; the expiry still bounds the request.
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [waitingId, claim]);

  const onExpire = useCallback(() => {
    setPhase((p) => (p.name === 'waiting' ? { name: 'expired' } : p));
  }, []);

  return (
    <div className="grid overflow-hidden rounded-panel border border-line bg-surface shadow-mid md:grid-cols-[1fr_1.05fr]">
      <div className="border-b border-line p-6 sm:p-8 md:border-r md:border-b-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Connect this device</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Use your phone, already signed in to OneAuth, to approve this device.</p>
        <ol className="mt-8 space-y-5">
          <Instruction n={1}>Open your phone’s camera and scan the code.</Instruction>
          <Instruction n={2}>Pick the code that matches the one on this screen.</Instruction>
          <Instruction n={3}>Choose what this device can access, then confirm with your passkey.</Instruction>
        </ol>
        <p className="mt-8 text-[13px] leading-relaxed text-muted">
          Can’t scan? On your phone, open OneAuth, go to <strong className="font-medium text-fg">Devices → Connect a device</strong> and
          type the code.
        </p>
      </div>

      <div className="flex min-h-[420px] flex-col items-center justify-center p-6 sm:p-8" aria-live="polite">
        {phase.name === 'creating' ? (
          <Status icon={<Spinner className="size-6" />} title="Creating a secure request…" />
        ) : phase.name === 'waiting' ? (
          <div className="flex w-full flex-col items-center animate-scale-in">
            <div className="relative">
              <span className="absolute -inset-3 animate-pulse-ring rounded-[28px] border border-accent/40" aria-hidden="true" />
              <div
                className="relative size-[200px] rounded-[20px] bg-white p-4 shadow-mid ring-1 ring-black/5 [&_svg]:size-full"
                role="img"
                aria-label="QR code to approve this device from your phone"
                dangerouslySetInnerHTML={{ __html: phase.qr }}
              />
            </div>
            <p className="mt-7 text-[12px] font-medium tracking-wide text-muted uppercase">Confirmation code</p>
            <p className="mt-1 font-mono text-[32px] font-medium tracking-[0.12em] tabular" data-testid="pairing-code">
              {phase.code}
            </p>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
              <Spinner className="size-3.5" />
              Waiting for approval · expires in{' '}
              <Countdown until={phase.expiresAt} onExpire={onExpire} className="font-medium text-fg tabular" />
            </p>
          </div>
        ) : phase.name === 'claiming' ? (
          <Status icon={<Spinner className="size-6" />} title="Approved. Finishing setup…" />
        ) : phase.name === 'connected' ? (
          <Status
            icon={
              <span className="relative grid size-14 place-items-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="size-7" />
              </span>
            }
            title="This device is connected"
            body="Opening your OneAuth…"
          />
        ) : phase.name === 'rejected' ? (
          <Status
            icon={<ShieldX className="size-7 text-danger" />}
            title="The request was declined"
            body="Nothing was shared with this device. If you didn’t decline it, someone may have picked the wrong code."
            action={<RetryButton onClick={start} />}
          />
        ) : phase.name === 'expired' ? (
          <Status
            icon={<TimerOff className="size-7 text-muted" />}
            title="This code has expired"
            body="Codes work once and only for five minutes."
            action={<RetryButton onClick={start} label="Get a new code" />}
          />
        ) : (
          <Status icon={<Smartphone className="size-7 text-muted" />} title="Something went wrong" body={phase.message} action={<RetryButton onClick={start} />} />
        )}
      </div>
    </div>
  );
}

function Instruction({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-sunken font-mono text-[12px] text-muted">
        {n}
      </span>
      <span className="pt-0.5 text-[15px]">{children}</span>
    </li>
  );
}

function Status({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex max-w-xs animate-scale-in flex-col items-center text-center">
      <div className="mb-4 grid min-h-14 place-items-center">{icon}</div>
      <p className="text-lg font-semibold">{title}</p>
      {body ? <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
      <Mark className="mt-10 size-5 opacity-40" />
    </div>
  );
}

function RetryButton({ onClick, label = 'Try again' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      <RefreshCw />
      {label}
    </Button>
  );
}

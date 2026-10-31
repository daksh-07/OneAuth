'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Lock, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Countdown, RelativeTime } from '@/components/ui/time';
import { DeviceIcon } from '@/components/app/device-icon';
import { cn } from '@/lib/cn';
import { isCancellation, passkeyErrorMessage, postJson, stepUp } from '@/lib/client/api';

type Kind = 'owned' | 'shared';

interface Props {
  request: {
    id: string;
    requestedName: string;
    platform: string;
    createdAt: string;
    expiresAt: string;
    sameNetwork: boolean | null;
    codeChoices: string[] | null;
  };
  typedCode: string | null;
  config: {
    scopes: Record<string, string>;
    grantable: Record<Kind, string[]>;
    defaults: Record<Kind, string[]>;
    durations: Record<Kind, { seconds: number; label: string }[]>;
    future: { label: string; note: string }[];
  };
}

type Outcome = null | 'approved' | 'declined' | 'mismatch' | 'expired';

export function ApproveFlow({ request, typedCode, config }: Props) {
  const [code, setCode] = useState<string | null>(typedCode);
  const [kind, setKind] = useState<Kind>('shared');
  const [scopes, setScopes] = useState<string[]>(config.defaults.shared);
  const [ttl, setTtl] = useState<number>(config.durations.shared[1].seconds);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Remote relay attacks usually come from another network, so ask for an explicit confirmation there.
  const needsPresenceConfirm = request.sameNetwork !== true;
  const [present, setPresent] = useState(false);

  const durationLabel = useMemo(() => config.durations[kind].find((d) => d.seconds === ttl)?.label, [config, kind, ttl]);

  function chooseKind(k: Kind) {
    setKind(k);
    setScopes(config.defaults[k]);
    setTtl(k === 'owned' ? config.durations.owned[1].seconds : config.durations.shared[1].seconds);
  }

  function toggleScope(s: string) {
    if (s === 'profile:read') return;
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function approve() {
    if (!code) {
      setError('Choose the code shown on the other device first.');
      return;
    }
    if (needsPresenceConfirm && !present) {
      setError('Confirm that the device is in front of you.');
      return;
    }
    setError(null);
    setPending('approve');
    try {
      await stepUp(request.id);
      const res = await postJson<{ ok: boolean; reason?: string }>('/api/pairing/approve', {
        requestId: request.id,
        confirmedCode: code,
        kind,
        scopes,
        ttlSeconds: ttl,
      });
      setOutcome(res.ok ? 'approved' : 'mismatch');
    } catch (err) {
      if ((err as { code?: string }).code === 'not_pending') setOutcome('expired');
      else setError(isCancellation(err) ? 'Approval cancelled. Nothing was shared.' : passkeyErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function decline() {
    setPending('decline');
    try {
      await postJson('/api/pairing/reject', { requestId: request.id });
      setOutcome('declined');
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (outcome) return <OutcomeView outcome={outcome} name={request.requestedName} duration={durationLabel ?? ''} />;

  return (
    <div className="animate-fade-up space-y-5">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Connect a new device?</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Expires in <Countdown until={request.expiresAt} onExpire={() => setOutcome('expired')} className="font-medium text-fg tabular" />
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface p-4 shadow-low">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-[12px] bg-sunken [&_svg]:size-5">
            <DeviceIcon platform={request.platform} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{request.requestedName}</p>
            <p className="text-[13px] text-muted">
              Requested <RelativeTime value={request.createdAt} /> · name reported by the device
            </p>
          </div>
        </div>
        <div className="mt-3.5 border-t border-line pt-3.5">
          {request.sameNetwork === true ? (
            <Badge tone="success">
              <Wifi className="size-3" aria-hidden="true" />
              Same network as this phone
            </Badge>
          ) : request.sameNetwork === false ? (
            <Badge tone="warning">
              <WifiOff className="size-3" aria-hidden="true" />
              Different network from this phone
            </Badge>
          ) : (
            <Badge>Network couldn’t be compared</Badge>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            A matching network is a hint, not proof the device is near you. Phones on mobile data usually show as different.
          </p>
        </div>
      </div>

      <Notice tone="warning" title="Only approve a device you can see">
        Continue only if you started this yourself on a device in front of you. OneAuth will never ask you to approve a code
        sent by phone, email or message.
      </Notice>

      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-semibold">1. Which code is on the other screen?</legend>
        {typedCode ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            You entered <span className="font-mono font-medium text-fg">{typedCode}</span>
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {request.codeChoices?.map((c) => (
              <label
                key={c}
                className={cn(
                  'flex h-14 cursor-pointer items-center justify-center rounded-card border bg-surface font-mono text-[17px] font-medium tracking-[0.08em] transition-colors',
                  code === c ? 'border-accent bg-accent-soft ring-2 ring-accent/30' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name="code" value={c} checked={code === c} onChange={() => setCode(c)} className="sr-only" />
                {c}
              </label>
            ))}
          </div>
        )}
        <p className="text-[13px] text-muted">Picking the wrong code cancels the request.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">2. Whose device is it?</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          <KindOption
            active={kind === 'shared'}
            onSelect={() => chooseKind('shared')}
            title="Shared or temporary"
            body="Hotel, friend’s or public device. Up to 24 hours, view-only."
          />
          <KindOption
            active={kind === 'owned'}
            onSelect={() => chooseKind('owned')}
            title="My own device"
            body="A computer or tablet you own. Up to 30 days, renewable."
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">3. What can it access?</legend>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {config.grantable[kind].map((s) => {
            const locked = s === 'profile:read';
            return (
              <li key={s}>
                <label className={cn('flex items-center gap-3 px-4 py-3', locked ? 'cursor-default' : 'cursor-pointer')}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    disabled={locked}
                    onChange={() => toggleScope(s)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="flex-1 text-sm">{config.scopes[s]}</span>
                  {locked ? <span className="text-[12px] text-muted">Always included</span> : null}
                </label>
              </li>
            );
          })}
          {config.future.map((f) => (
            <li key={f.label} className="flex items-center gap-3 px-4 py-3 text-muted">
              <Lock className="size-4" aria-hidden="true" />
              <span className="flex-1 text-sm">{f.label}</span>
              <span className="text-[12px]">{f.note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-muted">Passkeys and account deletion can only be managed from a device you signed in to yourself.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">4. For how long?</legend>
        <div className="flex flex-wrap gap-2">
          {config.durations[kind].map((d) => (
            <label
              key={d.seconds}
              className={cn(
                'cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors',
                ttl === d.seconds ? 'border-accent bg-accent-soft font-medium text-accent-text' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <input type="radio" name="ttl" className="sr-only" checked={ttl === d.seconds} onChange={() => setTtl(d.seconds)} />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsPresenceConfirm ? (
        <label className="flex cursor-pointer gap-3 rounded-card border border-warning/40 bg-warning-soft p-4">
          <input
            type="checkbox"
            checked={present}
            onChange={(e) => setPresent(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-sm leading-relaxed">
            <span className="font-medium">The device is in front of me and I started this myself.</span>{' '}
            <span className="text-muted">Don’t continue if a website, message or caller asked you to scan this.</span>
          </span>
        </label>
      ) : null}

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-line bg-canvas/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0">
        <Button variant="secondary" size="lg" className="flex-1" onClick={decline} loading={pending === 'decline'} disabled={pending !== null}>
          Decline
        </Button>
        <Button size="lg" className="flex-[1.6]" onClick={approve} loading={pending === 'approve'} disabled={pending !== null}>
          Approve with passkey
        </Button>
      </div>
    </div>
  );
}

function KindOption({ active, onSelect, title, body }: { active: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'rounded-card border p-3.5 text-left transition-colors',
        active ? 'border-accent bg-accent-soft ring-2 ring-accent/25' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-[12px] leading-snug text-muted">{body}</span>
    </button>
  );
}

function OutcomeView({ outcome, name, duration }: { outcome: Exclude<Outcome, null>; name: string; duration: string }) {
  const map = {
    approved: {
      icon: <CheckCircle2 className="size-7 text-success" />,
      bg: 'bg-success-soft',
      title: 'Approved',
      body: `Check the screen of ${name}: it should now say it’s connected to your OneAuth. Its access ends after ${duration}, or sooner if you disconnect it.`,
    },
    declined: { icon: <ShieldAlert className="size-7 text-muted" />, bg: 'bg-sunken', title: 'Request declined', body: 'Nothing was shared with that device.' },
    mismatch: {
      icon: <ShieldAlert className="size-7 text-danger" />,
      bg: 'bg-danger-soft',
      title: 'Request cancelled',
      body: 'The code you picked didn’t match. If someone sent you this link or code, don’t approve it. Otherwise, start again on the device.',
    },
    expired: { icon: <ShieldAlert className="size-7 text-muted" />, bg: 'bg-sunken', title: 'This request has expired', body: 'Start again on the device you want to connect.' },
  }[outcome];
  return (
    <div className="animate-scale-in rounded-panel border border-line bg-surface p-6 text-center shadow-low sm:p-8" role="status">
      <span className={cn('mx-auto grid size-14 place-items-center rounded-full', map.bg)}>{map.icon}</span>
      <h1 className="mt-4 text-xl font-semibold">{map.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{map.body}</p>
      <ButtonLink href="/devices" variant="secondary" className="mt-6">
        Go to Devices
      </ButtonLink>
    </div>
  );
}

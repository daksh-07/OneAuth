import { Check, Clock3, Fingerprint, KeyRound, Laptop, QrCode, ServerCog, ShieldCheck, Tv, Unplug } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { TrustGraph } from '@/components/brand/trust-graph';

export default async function Landing({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <>
      {deleted ? (
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          <Notice tone="success" title="Your account was deleted">
            Your passkey records, devices, sessions and security history have been removed from OneAuth. Passkeys stored in your
            device’s password manager can be deleted there.
          </Notice>
        </div>
      ) : null}

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-24">
        <div className="animate-fade-up">
          <Badge tone="accent" className="mb-6">
            Early access preview
          </Badge>
          <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-[56px]">
            Your digital life.
            <br />
            <span className="text-muted">One identity.</span>
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
            Keep your files, devices and supported accounts connected, on your terms. Approve a new device from your phone, choose
            exactly what it gets, and switch it off whenever you like.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg">
              Get started
            </ButtonLink>
            <ButtonLink href="/how-it-works" size="lg" variant="secondary">
              How OneAuth works
            </ButtonLink>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
            <Fingerprint className="size-4" aria-hidden="true" />
            Sign in with a passkey. No password to remember or leak.
          </p>
        </div>
        <div className="animate-fade-up [animation-delay:120ms]">
          <TrustGraph />
        </div>
      </section>

      <section aria-labelledby="pairing-heading" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-[13px] font-medium text-accent-text">OneAuth Connect</p>
          <h2 id="pairing-heading" className="mt-2 max-w-xl text-[28px] leading-tight font-semibold sm:text-[34px]">
            A new laptop, connected in under a minute.
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            <Step n={1} icon={<QrCode />} title="The new device shows a code">
              Open OneAuth on the laptop. It displays a QR code and a short code that expire after five minutes.
            </Step>
            <Step n={2} icon={<Fingerprint />} title="Your phone checks and confirms">
              Scan it, pick the code you see on the laptop, and approve with Face ID, a fingerprint or your screen lock.
            </Step>
            <Step n={3} icon={<Clock3 />} title="You choose what it gets">
              Decide whether it’s yours or borrowed, what it can see and how long access lasts. Revoke it any time.
            </Step>
          </ol>
        </div>
      </section>

      <section aria-labelledby="kinds-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 id="kinds-heading" className="max-w-xl text-[28px] leading-tight font-semibold sm:text-[34px]">
          Your devices and borrowed ones are treated differently.
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <KindCard
            icon={<Laptop />}
            title="Owned device"
            tone="success"
            label="Ongoing access"
            points={['Stays connected for up to 30 days at a time', 'Can see your devices and security history', 'Can manage other devices if you allow it']}
          />
          <KindCard
            icon={<Tv />}
            title="Shared or temporary device"
            tone="warning"
            label="Expires automatically"
            points={['Access lasts from 15 minutes to 24 hours', 'Starts with the minimum: just your name', 'Can never change your passkeys or account']}
          />
        </div>
        <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-muted">
          A borrowed computer may already be compromised. Temporary access limits what OneAuth shares and for how long, but it
          can’t protect against malware, screen recording or someone looking over your shoulder.
        </p>
      </section>

      <section aria-labelledby="status-heading" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 id="status-heading" className="max-w-xl text-[28px] leading-tight font-semibold sm:text-[34px]">
            What works today, and what doesn’t yet.
          </h2>
          <p className="mt-3 max-w-xl text-[15px] text-muted">We’d rather tell you exactly where we are than promise what we can’t deliver.</p>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <StatusColumn
              tone="success"
              title="Available now"
              items={[
                'Passkey account and sign-in',
                'QR pairing with code matching',
                'Owned and temporary device access',
                'Server-enforced expiry and revocation',
                'Security history and data export',
              ]}
            />
            <StatusColumn
              tone="accent"
              title="In development"
              items={[
                'OneAuth Cloud with client-side encryption',
                'OneAuth Space: portable workspace',
                'Account recovery',
                'iOS and Android approval apps',
              ]}
            />
            <StatusColumn
              tone="neutral"
              title="Depends on partners"
              items={[
                'Hotel and smart-TV sessions',
                'Signing in to third-party services',
                'External cloud storage connections',
              ]}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="principles-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 id="principles-heading" className="max-w-xl text-[28px] leading-tight font-semibold sm:text-[34px]">
          Built to be trusted, not just to look secure.
        </h2>
        <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2">
          <Principle icon={<KeyRound />} title="Your biometrics stay on your phone">
            Face ID and fingerprints unlock a passkey on your device. OneAuth only ever receives a signed proof, never your face or
            fingerprint.
          </Principle>
          <Principle icon={<ServerCog />} title="Revocation is enforced on our servers">
            When you disconnect a device, its OneAuth sessions stop working on its very next request, whether or not the device is
            online.
          </Principle>
          <Principle icon={<ShieldCheck />} title="Nothing is shared by default">
            Every connection lists exactly what it can see and when it ends. Temporary devices start with the minimum.
          </Principle>
          <Principle icon={<Unplug />} title="Honest about limits">
            Revoking access can’t delete anything a device already downloaded, photographed or copied. We’ll always say so.
          </Principle>
        </div>
        <div className="mt-14 flex flex-col items-start gap-4 rounded-panel border border-line bg-surface p-6 shadow-low sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-lg font-semibold">Create your OneAuth identity</p>
            <p className="mt-1 text-sm text-muted">It takes one passkey and about ten seconds.</p>
          </div>
          <ButtonLink href="/signup" size="lg">
            Get started
          </ButtonLink>
        </div>
      </section>
    </>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="relative rounded-card border border-line bg-canvas p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-[18px]">{icon}</span>
        <span className="font-mono text-[12px] text-muted tabular">0{n}</span>
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}

function KindCard({
  icon,
  title,
  label,
  tone,
  points,
}: {
  icon: React.ReactNode;
  title: string;
  label: string;
  tone: 'success' | 'warning';
  points: string[];
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-low">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-[11px] bg-sunken [&_svg]:size-5">{icon}</span>
        <Badge tone={tone} dot>
          {label}
        </Badge>
      </div>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm text-muted">
            <Check className="mt-0.5 size-4 shrink-0 text-fg" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusColumn({ tone, title, items }: { tone: 'success' | 'accent' | 'neutral'; title: string; items: string[] }) {
  return (
    <div className="rounded-card border border-line bg-canvas p-5">
      <Badge tone={tone} dot>
        {title}
      </Badge>
      <ul className="mt-4 divide-y divide-line">
        {items.map((i) => (
          <li key={i} className="py-2.5 text-sm">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Principle({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-line bg-surface text-fg shadow-low [&_svg]:size-[18px]">
        {icon}
      </span>
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

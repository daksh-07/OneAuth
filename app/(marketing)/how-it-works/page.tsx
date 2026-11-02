import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

export const metadata: Metadata = {
  title: 'How OneAuth works',
  description: 'What stays on your device, what OneAuth stores, what it can’t access, and what happens if you lose your phone.',
};

export default function HowItWorks() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <p className="text-[13px] font-medium text-accent-text">Security model</p>
      <h1 className="mt-2 text-[34px] leading-tight font-semibold sm:text-[44px]">How OneAuth works</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-muted">
        You shouldn’t need to understand cryptography to know where your information goes. Here’s the plain-language version.
      </p>

      <Section title="What stays on your device">
        <li>
          <strong>Your passkey’s private key.</strong> It’s created and kept by your phone, computer or security key, often
          inside dedicated security hardware. OneAuth never sees it.
        </li>
        <li>
          <strong>Your face and fingerprint.</strong> Face ID, Touch ID and Android biometrics only unlock the passkey on your
          device. No biometric data is sent to OneAuth.
        </li>
      </Section>

      <Section title="What OneAuth stores">
        <li>Your display name. We don’t ask for an email address yet.</li>
        <li>The public half of each passkey, which can check a signature but can’t create one.</li>
        <li>
          Your devices, what each one is allowed to see, when that access ends, and a security history of sign-ins, approvals and
          revocations, including the network address and browser they came from.
        </li>
        <li>
          Session records. The cookie on your device holds a random token; we store only a one-way fingerprint of it, so a copy
          of our database can’t be used to sign in as you.
        </li>
      </Section>

      <Section title="What OneAuth can and can’t do">
        <li>
          <strong>We can</strong> end any OneAuth session immediately. Revoked devices are refused on their next request.
        </li>
        <li>
          <strong>We can’t</strong> sign you in to Apple, Google, Microsoft, Netflix or other services. Those connections only
          arrive where a service offers a supported way to do it, and we’ll label each one clearly.
        </li>
        <li>
          <strong>We can’t</strong> remove anything a device has already downloaded, photographed or copied, and we can’t
          protect a computer that already has malware on it.
        </li>
      </Section>

      <Section title="When you connect a new device">
        <li>The new device shows a code that works once and expires after five minutes.</li>
        <li>
          On your phone you pick the matching code from three options. That shows you can see the device yourself, which guards
          against someone sending you their QR code. A wrong pick cancels the request.
        </li>
        <li>You confirm with your passkey, then choose whether it’s yours or borrowed, what it can see and how long access lasts.</li>
        <li>
          Only approve a device you can see in front of you and that you started connecting yourself. OneAuth support will
          never ask you to approve a code.
        </li>
      </Section>

      <Section title="If you lose your phone">
        <li>
          If your passkey syncs (iCloud Keychain, Google Password Manager, or a password manager that supports passkeys), you can
          sign in from another device that has it, then revoke the lost phone under Devices.
        </li>
        <li>
          If you’ve added a second passkey, such as on a laptop or a hardware security key, you can use that instead.
        </li>
      </Section>
      <Notice tone="warning" title="Account recovery isn’t available yet" className="mt-4">
        If you lose every passkey for your account, you won’t be able to sign in again, and we deliberately have no way to
        override that. Add a second passkey from Account &amp; Security. A recovery process that doesn’t give our staff a back
        door is being designed before OneAuth Cloud stores any files.
      </Notice>

      <Section title="Encrypted files">
        <li>
          OneAuth Cloud isn’t available yet. Files will be encrypted on your device before upload, using established, reviewed
          cryptography. We won’t describe it as “zero-knowledge” until the design has been independently reviewed.
        </li>
      </Section>

      <div className="mt-12 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/signup" size="lg">
          Get started
        </ButtonLink>
        <ButtonLink href="/" size="lg" variant="secondary">
          Back to overview
        </ButtonLink>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-muted marker:text-subtle [&_strong]:font-medium [&_strong]:text-fg">
        {children}
      </ul>
    </section>
  );
}

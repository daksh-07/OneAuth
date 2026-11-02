import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server/auth';
import { isBackendConfigured } from '@/lib/server/env';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create your identity' };

export default async function SignupPage() {
  if (await getSession()) redirect('/home');
  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">Create your OneAuth identity</h1>
      <p className="mt-2 mb-8 text-[15px] leading-relaxed text-muted">
        Your device will create a passkey and ask for Face ID, your fingerprint or screen lock. Your biometrics never leave the
        device.
      </p>
      <SignupForm configured={isBackendConfigured()} />
    </>
  );
}

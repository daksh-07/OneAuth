import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server/auth';
import { isBackendConfigured } from '@/lib/server/env';
import { safeNext } from '@/lib/safe-next';
import { SigninForm } from './signin-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SigninPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 mb-8 text-[15px] leading-relaxed text-muted">Sign in with the passkey you created for OneAuth.</p>
      <SigninForm configured={isBackendConfigured()} next={next} />
    </>
  );
}

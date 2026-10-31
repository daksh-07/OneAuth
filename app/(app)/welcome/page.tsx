import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePageSession } from '@/lib/server/auth';
import { getAccount, listPasskeys } from '@/lib/server/account';
import { hasScope } from '@/lib/scopes';
import { WelcomeFlow } from './welcome-flow';

export const metadata: Metadata = { title: 'Welcome' };

export default async function WelcomePage() {
  const session = await requirePageSession();
  if (!hasScope(session.scopes, 'security:manage')) redirect('/home');
  const [account, passkeys] = await Promise.all([getAccount(session.user_id), listPasskeys(session.user_id)]);
  if (account?.onboarded_at) redirect('/home');
  return <WelcomeFlow name={session.display_name.split(/\s+/)[0]} passkeySynced={passkeys.some((p) => p.backed_up)} />;
}

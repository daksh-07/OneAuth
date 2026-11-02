import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { isBackendConfigured } from './env';
import { COOKIE, readCookie } from './request';
import { validateSessionToken, type SessionRecord } from './sessions';
import { UserFacingError } from './errors';
import { hasScope, type Scope } from '../scopes';

/** The current session, validated against the database once per request. */
export const getSession = cache(async (): Promise<SessionRecord | null> => {
  if (!isBackendConfigured()) return null;
  return validateSessionToken(await readCookie(COOKIE.session));
});

/** For pages: redirects to sign-in when there is no valid session. */
export async function requirePageSession(): Promise<SessionRecord> {
  const session = await getSession();
  if (!session) redirect('/signin');
  return session;
}

/** For actions and route handlers: throws when unauthenticated or missing a scope. */
export async function requireSession(scope?: Scope): Promise<SessionRecord> {
  const session = await getSession();
  if (!session) throw new UserFacingError('unauthenticated', 'Your session has ended. Sign in again.', 401);
  if (scope && !hasScope(session.scopes, scope)) {
    throw new UserFacingError('forbidden', 'This device doesn’t have permission to do that.', 403);
  }
  return session;
}

import { randomBytes } from 'node:crypto';
import { beginLogin, beginRegistration, beginStepUp, finishLogin, finishRegistration, finishStepUp } from '@/lib/server/webauthn';
import { validateSessionToken, type SessionRecord } from '@/lib/server/sessions';
import { SoftAuthenticator } from './soft-authenticator';

export const ORIGIN = 'http://localhost:3000';
export const ctx = (ip = '203.0.113.10') => ({ ip, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });

export interface TestUser {
  authenticator: SoftAuthenticator;
  token: string;
  deviceKey: string;
  userId: string;
  session: () => Promise<SessionRecord>;
}

export async function createUser(name = 'Alex Chen', opts: { shared?: boolean; ip?: string } = {}): Promise<TestUser> {
  const authenticator = new SoftAuthenticator();
  const { challengeId, options } = await beginRegistration({ displayName: name, origin: ORIGIN }, ctx(opts.ip));
  const res = await finishRegistration(
    {
      challengeId,
      response: authenticator.register(options, ORIGIN),
      origin: ORIGIN,
      device: { deviceKey: randomBytes(16).toString('base64url'), kind: opts.shared ? 'shared' : 'owned' },
    },
    ctx(opts.ip),
  );
  return {
    authenticator,
    token: res.token,
    deviceKey: res.deviceKey,
    userId: res.userId,
    session: async () => (await validateSessionToken(res.token))!,
  };
}

export async function signIn(user: TestUser, opts: { shared?: boolean; deviceKey?: string | null } = {}) {
  const { challengeId, options } = await beginLogin({ origin: ORIGIN }, ctx());
  return finishLogin(
    {
      challengeId,
      response: user.authenticator.authenticate(options, ORIGIN),
      origin: ORIGIN,
      device: { deviceKey: opts.deviceKey ?? null, kind: opts.shared ? 'shared' : 'owned' },
    },
    ctx(),
  );
}

export async function stepUpSession(user: TestUser, session: SessionRecord, pairingRequestId?: string) {
  const { challengeId, options } = await beginStepUp(session, ORIGIN, pairingRequestId);
  await finishStepUp(session, { challengeId, response: user.authenticator.authenticate(options, ORIGIN), origin: ORIGIN }, ctx());
  return (await validateSessionToken(user.token))!;
}

import { afterAll, beforeEach } from 'vitest';
import { appUrl, TEST_OWNER_URL } from './db-urls';

// The application under test connects as the least-privilege runtime role.
process.env.DATABASE_URL = TEST_OWNER_URL;
process.env.ONEAUTH_RUNTIME_DATABASE_URL = appUrl(TEST_OWNER_URL);

const { closePool } = await import('@/lib/server/db');
const admin = await import('./admin');

beforeEach(async () => {
  await admin.query(
    `truncate users, user_profiles, authenticators, devices, sessions, device_pairing_requests, device_grants,
              webauthn_challenges, security_events, rate_limits, subscriptions restart identity cascade`,
  );
});

afterAll(async () => {
  await closePool();
  await admin.closeAdmin();
});

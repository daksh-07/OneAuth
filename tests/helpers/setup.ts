import { afterAll, beforeEach } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_test';

const { query, closePool } = await import('@/lib/server/db');

beforeEach(async () => {
  await query(
    `truncate users, user_profiles, authenticators, devices, sessions, device_pairing_requests, device_grants,
              webauthn_challenges, security_events, rate_limits, subscriptions restart identity cascade`,
  );
});

afterAll(async () => {
  await closePool();
});

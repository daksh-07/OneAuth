/** Owner (migrations, assertions) and least-privilege runtime connections for tests. */
export const TEST_OWNER_URL = process.env.TEST_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_test';
export const TEST_APP_PASSWORD = process.env.TEST_APP_PASSWORD ?? 'local-test-app-password-0123456789';

export function appUrl(ownerUrl: string, password = TEST_APP_PASSWORD) {
  const u = new URL(ownerUrl);
  u.username = 'oneauth_app';
  u.password = password;
  return u.toString();
}

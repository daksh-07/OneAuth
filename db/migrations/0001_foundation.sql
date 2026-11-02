-- OneAuth foundation schema: identity, passkeys, devices, sessions, pairing, audit.
-- Forward-only. Never edit a migration after it has been applied to a shared database.

create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  -- Opaque WebAuthn user handle. Random, never derived from personal data.
  webauthn_user_id bytea not null unique,
  display_name  text not null check (char_length(display_name) between 1 and 64),
  status        text not null default 'active' check (status in ('active', 'locked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table user_profiles (
  user_id       uuid primary key references users(id) on delete cascade,
  primary_use   text check (primary_use in ('files', 'devices', 'temporary', 'explore')),
  onboarded_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create table authenticators (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  credential_id   text not null unique,          -- base64url
  public_key      bytea not null,                -- COSE public key; not secret
  counter         bigint not null default 0 check (counter >= 0),
  transports      text[] not null default '{}',
  device_type     text not null check (device_type in ('singleDevice', 'multiDevice')),
  backed_up       boolean not null default false,
  aaguid          text,
  nickname        text not null default 'Passkey' check (char_length(nickname) between 1 and 48),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);
create index authenticators_user_idx on authenticators(user_id);

create table devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  -- SHA-256 of a random identifier held in an HttpOnly cookie on the device.
  device_key_hash bytea not null unique,
  name            text not null check (char_length(name) between 1 and 64),
  platform        text not null default 'unknown',
  kind            text not null check (kind in ('owned', 'shared')),
  enrolled_via    text not null check (enrolled_via in ('passkey', 'pairing')),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  revoked_at      timestamptz
);
create index devices_user_idx on devices(user_id);

create table sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  device_id       uuid not null references devices(id) on delete cascade,
  token_hash      bytea not null unique,          -- SHA-256 of the cookie token; raw token never stored
  kind            text not null check (kind in ('primary', 'paired')),
  scopes          text[] not null,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null,
  reauth_at       timestamptz,                    -- last passkey step-up verification
  revoked_at      timestamptz,
  revoke_reason   text,
  ip              inet,
  user_agent      text,
  check (expires_at > created_at)
);
create index sessions_user_idx on sessions(user_id);
create index sessions_device_idx on sessions(device_id);

create table device_pairing_requests (
  id                  uuid primary key default gen_random_uuid(),
  -- SHA-256 of a secret held only by the requesting browser (HttpOnly cookie).
  secret_hash         bytea not null unique,
  user_code           text not null,
  requested_name      text not null,
  platform            text not null default 'unknown',
  user_agent          text,
  ip                  inet,
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected', 'claimed')),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  decided_at          timestamptz,
  approver_user_id    uuid references users(id) on delete cascade,
  approver_session_id uuid references sessions(id) on delete set null,
  grant_kind          text check (grant_kind in ('owned', 'shared')),
  grant_scopes        text[],
  grant_ttl_seconds   integer check (grant_ttl_seconds > 0),
  claimed_at          timestamptz,
  claimed_session_id  uuid references sessions(id) on delete set null,
  check (status = 'pending' or decided_at is not null),
  check (status not in ('approved', 'claimed') or (grant_kind is not null and grant_scopes is not null and grant_ttl_seconds is not null))
);
-- A live code must be unambiguous; expired rows may reuse codes.
create index pairing_code_idx on device_pairing_requests(user_code, expires_at);

-- Every grant a device holds. Sessions created from pairing reference the grant's scopes;
-- the session row is the enforcement point, this table is the durable record.
create table device_grants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  device_id       uuid not null references devices(id) on delete cascade,
  pairing_request_id uuid references device_pairing_requests(id) on delete set null,
  scopes          text[] not null,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  check (expires_at > issued_at)
);
create index device_grants_device_idx on device_grants(device_id);

create table webauthn_challenges (
  id              uuid primary key default gen_random_uuid(),
  purpose         text not null check (purpose in ('register', 'login', 'stepup', 'add-passkey')),
  challenge       text not null,
  user_id         uuid references users(id) on delete cascade,
  session_id      uuid references sessions(id) on delete cascade,
  data            jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  consumed_at     timestamptz
);
create index webauthn_challenges_expiry_idx on webauthn_challenges(expires_at);

create table security_events (
  id              bigint generated always as identity primary key,
  user_id         uuid references users(id) on delete cascade,
  device_id       uuid references devices(id) on delete set null,
  session_id      uuid references sessions(id) on delete set null,
  type            text not null,
  detail          jsonb not null default '{}',
  ip              inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index security_events_user_idx on security_events(user_id, created_at desc);

create table rate_limits (
  key             text not null,
  window_start    timestamptz not null,
  count           integer not null,
  primary key (key, window_start)
);

-- Billing placeholders: entitlements are configuration-driven (lib/plans.ts).
-- No payment provider is connected; every user is on the free plan.
create table subscriptions (
  user_id         uuid primary key references users(id) on delete cascade,
  plan_id         text not null default 'free',
  status          text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  provider        text,
  provider_ref    text,
  updated_at      timestamptz not null default now()
);

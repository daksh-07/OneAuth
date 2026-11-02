-- Phase 2B: longer device fingerprints, staged vault-key rotation, encrypted
-- Space items and Space preferences. Design: docs/cloud/security-design.md,
-- docs/cloud/key-rotation.md. Additive apart from widening one check constraint.
-- Rollback: drop the new tables and columns; restore the old fingerprint check
-- after revoking any vault_devices row with a 12-character fingerprint.

-- 1. Security codes grow from 40 to 60 bits (XXXX-XXXX-XXXX). Existing 40-bit
--    rows stay valid; new registrations use the longer form.
alter table vault_devices drop constraint vault_devices_fingerprint_check;
alter table vault_devices add constraint vault_devices_fingerprint_check
  check (fingerprint ~ '^[A-Z2-7]{4}-[A-Z2-7]{4}(-[A-Z2-7]{4})?$');

-- 2. Staged vault-key rotation. While a rotation is in progress, the new
--    material lives in next_* columns; commit swaps it in atomically.
create table vault_rotations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  vault_id               uuid not null references vaults(id) on delete cascade,
  from_version           integer not null,
  to_version             integer not null check (to_version = from_version + 1),
  status                 text not null check (status in ('in_progress', 'committed', 'aborted')),
  reason                 text not null check (reason in ('device_removed', 'manual')),
  started_by             uuid references devices(id) on delete set null,
  next_recovery_envelope text not null check (char_length(next_recovery_envelope) between 40 and 128),
  next_recovery_verifier bytea not null check (length(next_recovery_verifier) = 32),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz
);
create unique index vault_rotations_one_open on vault_rotations(vault_id) where status = 'in_progress';
create index vault_rotations_user_idx on vault_rotations(user_id);

alter table vault_devices add column next_envelope text check (char_length(next_envelope) < 2048);
alter table cloud_files add column next_wrapped_key text check (char_length(next_wrapped_key) = 56);
alter table cloud_folders add column key_version integer not null default 1;
alter table cloud_folders add column next_encrypted_name text check (char_length(next_encrypted_name) < 1024);

-- 3. Space items: bookmarks and shortcuts, end-to-end encrypted with a key
--    derived from the vault key. The server sees only kind, order and timestamps.
create table space_items (
  id                  uuid primary key,                -- client-chosen: bound into the encrypted body
  space_id            uuid not null references spaces(id) on delete cascade,
  user_id             uuid not null references users(id) on delete cascade,
  kind                text not null check (kind in ('bookmark', 'shortcut')),
  encrypted_body      text not null check (char_length(encrypted_body) < 4096),
  next_encrypted_body text check (char_length(next_encrypted_body) < 4096),
  key_version         integer not null default 1,
  position            integer not null default 0,
  version             integer not null default 1,      -- optimistic concurrency between browsers
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index space_items_space_idx on space_items(space_id, kind, position);

-- 4. Space preferences (not sensitive; validated by the application).
alter table spaces add column prefs jsonb not null default '{}'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['vault_rotations', 'space_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public', t);
    execute format('grant select, insert, update, delete on table %I to oneauth_app', t);
    execute format('create policy tenant_rows on %I to oneauth_app using (user_id = app_uid()) with check (user_id = app_uid())', t);
  end loop;
end $$;
-- Rotation history is an audit record.
revoke delete on vault_rotations from oneauth_app;

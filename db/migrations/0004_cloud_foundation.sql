-- OneAuth Cloud foundation (developer preview). Design: docs/cloud/security-design.md.
-- Stores only ciphertext, wrapped keys and the metadata listed in §5 of the design.
-- Additive. Rollback: drop the tables below (no existing table is altered).

create table vaults (
  id                uuid primary key,                   -- chosen by the client: it salts key derivation
  user_id           uuid not null unique references users(id) on delete cascade,
  recovery_envelope text not null check (char_length(recovery_envelope) between 40 and 128),
  recovery_verifier bytea not null check (length(recovery_verifier) = 32), -- SHA-256 of the recovery proof (see lib/vault/crypto.ts)
  key_version       integer not null default 1 check (key_version >= 1),
  created_at        timestamptz not null default now()
);

-- A browser's vault access. The device's private key never leaves the browser;
-- `envelope` is the vault key encrypted to `public_jwk` (JWE), present only when active.
create table vault_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  vault_id      uuid not null references vaults(id) on delete cascade,
  device_id     uuid not null references devices(id) on delete cascade,
  public_jwk    jsonb not null,
  fingerprint   text not null check (fingerprint ~ '^[A-Z2-7]{4}-[A-Z2-7]{4}$'),
  status        text not null check (status in ('pending', 'active', 'revoked')),
  envelope      text check (char_length(envelope) < 2048),
  approved_via  text check (approved_via in ('creator', 'device', 'recovery')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  revoked_at    timestamptz,
  check ((status = 'active') = (envelope is not null)),
  check (status <> 'active' or approved_via is not null)
);
create unique index vault_devices_one_live_per_device on vault_devices(device_id) where status <> 'revoked';
create index vault_devices_user_idx on vault_devices(user_id);

create table cloud_folders (
  id              uuid primary key,                     -- client-chosen: bound into the encrypted name
  user_id         uuid not null references users(id) on delete cascade,
  parent_id       uuid references cloud_folders(id) on delete cascade,
  encrypted_name  text not null check (char_length(encrypted_name) < 1024),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  trashed_at      timestamptz,
  check (parent_id is null or parent_id <> id)
);
create index cloud_folders_user_parent_idx on cloud_folders(user_id, parent_id);

create table cloud_files (
  id              uuid primary key,                     -- client-chosen: bound into every chunk's AAD
  user_id         uuid not null references users(id) on delete cascade,
  folder_id       uuid references cloud_folders(id) on delete cascade,
  status          text not null check (status in ('uploading', 'ready')),
  size_bytes      bigint not null check (size_bytes > 0),          -- declared ciphertext size (reserved)
  stored_bytes    bigint not null default 0 check (stored_bytes >= 0),
  part_count      integer not null check (part_count >= 1),
  sha256          bytea not null check (length(sha256) = 32),       -- of the whole ciphertext object
  encrypted_meta  text not null check (char_length(encrypted_meta) < 4096),
  wrapped_key     text not null check (char_length(wrapped_key) = 56), -- AES-KW(VK, FK), 40 bytes base64
  key_version     integer not null default 1,
  favorite        boolean not null default false,
  uploaded_by     uuid references devices(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  trashed_at      timestamptz,
  check (stored_bytes <= size_bytes)
);
create index cloud_files_user_folder_idx on cloud_files(user_id, folder_id);
create index cloud_files_user_updated_idx on cloud_files(user_id, updated_at desc);

-- `postgres` storage driver (preview): ciphertext in transfer parts of at most 1 MiB.
create table cloud_object_parts (
  file_id   uuid not null references cloud_files(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  idx       integer not null check (idx >= 0),
  data      bytea not null check (length(data) between 1 and 1048576),
  primary key (file_id, idx)
);

-- Quota accounting. Reservations are taken when an upload starts and settled on completion.
create table storage_usage (
  user_id         uuid primary key references users(id) on delete cascade,
  used_bytes      bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes  bigint not null default 0 check (reserved_bytes >= 0)
);

-- ---------------------------------------------------------------------------
-- Least-privilege runtime access and tenant isolation (see 0003).

do $$
declare t text;
begin
  foreach t in array array['vaults', 'vault_devices', 'cloud_folders', 'cloud_files', 'cloud_object_parts', 'storage_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public', t);
    execute format('grant select, insert, update, delete on table %I to oneauth_app', t);
    execute format('create policy tenant_rows on %I to oneauth_app using (user_id = app_uid()) with check (user_id = app_uid())', t);
  end loop;
end $$;

-- The vault itself can't be deleted by the runtime except through account deletion (cascade as owner).
revoke delete on vaults from oneauth_app;

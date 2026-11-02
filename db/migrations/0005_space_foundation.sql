-- OneAuth Space foundation: workspaces a person carries between their devices.
-- Additive. Rollback: drop the tables below (no existing table is altered).
--
-- Space names and settings are account metadata (like device names) and are
-- stored in the clear. Pinned Cloud items are referenced by ID only; their
-- names stay encrypted in cloud_files / cloud_folders.

create table spaces (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  kind         text not null default 'personal' check (kind in ('personal', 'work', 'study', 'other')),
  accent       text not null default 'blue' check (accent in ('blue', 'green', 'amber', 'rose', 'violet', 'slate')),
  all_devices  boolean not null default true,     -- false: only the devices in space_devices show this space
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index spaces_user_idx on spaces(user_id, position);

create table space_devices (
  space_id   uuid not null references spaces(id) on delete cascade,
  device_id  uuid not null references devices(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  primary key (space_id, device_id)
);

create table space_pins (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  file_id     uuid references cloud_files(id) on delete cascade,
  folder_id   uuid references cloud_folders(id) on delete cascade,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  check ((file_id is null) <> (folder_id is null))
);
create unique index space_pins_file_uniq on space_pins(space_id, file_id) where file_id is not null;
create unique index space_pins_folder_uniq on space_pins(space_id, folder_id) where folder_id is not null;

-- The space each device last opened.
create table space_selection (
  device_id  uuid primary key references devices(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  space_id   uuid not null references spaces(id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['spaces', 'space_devices', 'space_pins', 'space_selection'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public', t);
    execute format('grant select, insert, update, delete on table %I to oneauth_app', t);
    execute format('create policy tenant_rows on %I to oneauth_app using (user_id = app_uid()) with check (user_id = app_uid())', t);
  end loop;
end $$;

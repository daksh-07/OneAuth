-- Phase 2C (developer preview). Design: docs/cloud/key-rotation.md (v2).
-- Additive. Rollback: drop the columns below.

-- 1. Transition proof: HMAC, under a key derived from the *outgoing* vault key,
--    over a commitment to the incoming one. A browser that holds the outgoing
--    key (or the verification key it stored earlier) checks it before trusting
--    or re-wrapping under a new vault key; the server can't forge it.
--    Nullable only so rows from before this migration stay valid; new
--    rotations must supply it (enforced by the application).
alter table vault_rotations add column transition_proof text check (char_length(transition_proof) = 44);

-- 2. Keeping the current recovery key through a rotation (the user re-enters
--    it so the new vault key is sealed under it). recovery_set_at lets the
--    server refuse this when a browser unlocked with that recovery key has
--    since been removed.
alter table vault_rotations add column keep_recovery boolean not null default false;
alter table vaults add column recovery_set_at timestamptz not null default now();

-- 3. Deep rotation: a file re-encrypted under a new file key is uploaded as a
--    new object that replaces the old one atomically when it completes.
alter table cloud_files add column replaces_file_id uuid;
create unique index cloud_files_one_replacement on cloud_files(replaces_file_id) where replaces_file_id is not null;

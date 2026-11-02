-- Least-privilege runtime role with row-level-security tenant isolation.
--
-- Migrations (and this file) run as the schema owner. The application runtime
-- connects as `oneauth_app`: not superuser, no BYPASSRLS, not the table owner,
-- DML only. Every authenticated request runs in a transaction that sets the
-- transaction-local GUC `oneauth.user_id`; policies restrict rows to that user.
-- The password is provisioned separately (scripts/provision-app-role.mjs) so
-- no secret lives in a migration.
--
-- Additive and reversible: see docs/security-review/database.md for rollback.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'oneauth_app') then
    -- Defaults are NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS. A non-superuser
    -- owner can't even name SUPERUSER, so the attributes are verified instead
    -- (scripts/db-verify.mjs fails the build if the role is ever elevated).
    create role oneauth_app nologin noinherit;
  end if;
end $$;

grant usage on schema public to oneauth_app;
revoke create on schema public from oneauth_app;

grant select, insert, update, delete on
  users, user_profiles, authenticators, devices, sessions, device_pairing_requests,
  device_grants, webauthn_challenges, rate_limits, subscriptions
  to oneauth_app;
-- Security events are append-only for the runtime (account deletion cascades as the owner).
grant select, insert on security_events to oneauth_app;
grant usage on all sequences in schema public to oneauth_app;
-- Never: schema_migrations, DDL, TRUNCATE, ownership.

-- The current tenant, or null outside an authenticated transaction.
create or replace function app_uid() returns uuid
  language sql stable
  set search_path = pg_catalog
as $$ select nullif(current_setting('oneauth.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Pre-authentication resolvers. Each returns only the owning user (or a
-- status) for a secret the caller must already hold, so the application can
-- then open a tenant-scoped transaction. SECURITY DEFINER, fixed search_path.

create or replace function oneauth_resolve_session(p_token_hash bytea) returns uuid
  language sql stable security definer
  set search_path = pg_catalog, public
as $$ select user_id from sessions where token_hash = p_token_hash $$;

create or replace function oneauth_resolve_credential(p_credential_id text) returns uuid
  language sql stable security definer
  set search_path = pg_catalog, public
as $$ select user_id from authenticators where credential_id = p_credential_id $$;

create or replace function oneauth_resolve_pairing(p_secret_hash bytea)
  returns table (id uuid, user_code text, status text, expires_at timestamptz, approver_user_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
as $$
  select id, user_code, status, expires_at, approver_user_id
    from device_pairing_requests where secret_hash = p_secret_hash
$$;

revoke all on function oneauth_resolve_session(bytea), oneauth_resolve_credential(text), oneauth_resolve_pairing(bytea) from public;
grant execute on function app_uid(), oneauth_resolve_session(bytea), oneauth_resolve_credential(text), oneauth_resolve_pairing(bytea) to oneauth_app;

-- ---------------------------------------------------------------------------
-- Policies (the runtime role is not the owner, so these apply to it).

create policy tenant_self on users to oneauth_app
  using (id = app_uid()) with check (id = app_uid());

create policy tenant_rows on user_profiles to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on subscriptions to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on authenticators to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on devices to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on sessions to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on device_grants to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy tenant_rows on security_events to oneauth_app
  using (user_id = app_uid()) with check (user_id = app_uid());

-- Anonymous (registration/sign-in) challenges have no user; user-bound ones
-- (step-up, add passkey) are visible only to that user.
create policy tenant_or_anonymous on webauthn_challenges to oneauth_app
  using (user_id is null or user_id = app_uid())
  with check (user_id is null or user_id = app_uid());

-- A pairing request has no owner until approved; once approved it belongs to
-- the approver. Pending/rejected requests are reachable only by UUID or by a
-- rate-limited code lookup in the application.
create policy unclaimed_or_approver on device_pairing_requests to oneauth_app
  using (approver_user_id is null or approver_user_id = app_uid())
  with check (approver_user_id is null or approver_user_id = app_uid());

-- Global counters keyed by IP or user ID; contain no personal data.
create policy global_counters on rate_limits to oneauth_app using (true) with check (true);

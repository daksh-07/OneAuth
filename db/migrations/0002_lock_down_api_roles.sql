-- Defence in depth for hosted Postgres providers that expose the public schema
-- over an HTTP API (e.g. Supabase PostgREST with the anon/authenticated roles).
-- OneAuth only accesses the database from its server, as the table owner.
-- Enabling RLS with no policies denies every non-owner, non-BYPASSRLS role.

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'user_profiles', 'authenticators', 'devices', 'sessions', 'device_pairing_requests',
    'device_grants', 'webauthn_challenges', 'security_events', 'rate_limits', 'subscriptions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public', t);
  end loop;
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end $$;

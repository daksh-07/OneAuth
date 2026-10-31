// Prints a credential-free report about the connected database: role
// privileges, table ownership, RLS state, constraints, indexes, TLS and
// migration history. Exits non-zero if a required invariant is violated.
import pg from 'pg';
import { pgConfig } from './pg-config.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[db-verify] DATABASE_URL is not set');
  process.exit(1);
}

const REQUIRED_TABLES = [
  'users', 'user_profiles', 'authenticators', 'devices', 'sessions', 'device_pairing_requests',
  'device_grants', 'webauthn_challenges', 'security_events', 'rate_limits', 'subscriptions', 'schema_migrations',
];

const client = new pg.Client(pgConfig(url));
await client.connect();
const problems = [];
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
try {
  // Client-side TLS evidence: pg_stat_ssl only describes the pooler→Postgres hop
  // when connecting through a pooler, so check our own socket instead.
  const socket = client.connection.stream;
  const clientTls = { encrypted: Boolean(socket.encrypted), authorized: socket.authorized === true, protocol: socket.getProtocol?.() ?? null };
  const [who] = await q(`select current_user as role, current_database() as db, version() as version,
                               (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as backend_ssl`);
  const [attrs] = await q(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user`);
  const memberOf = (await q(`select b.rolname from pg_auth_members m join pg_roles b on b.oid = m.roleid
                              join pg_roles r on r.oid = m.member where r.rolname = current_user order by 1`)).map((r) => r.rolname);
  console.log(`[db-verify] role=${who.role} db=${who.db} client_tls=${clientTls.encrypted} cert_verified=${clientTls.authorized} protocol=${clientTls.protocol} backend_ssl=${who.backend_ssl}`);
  console.log(`[db-verify] server=${who.version.split(' ').slice(0, 2).join(' ')}`);
  console.log(`[db-verify] role attributes: superuser=${attrs.rolsuper} bypassrls=${attrs.rolbypassrls} createrole=${attrs.rolcreaterole} createdb=${attrs.rolcreatedb} memberOf=[${memberOf.join(',')}]`);
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  if (!local && !(clientTls.encrypted && clientTls.authorized)) problems.push('remote connection is not using verified TLS');

  const tables = await q(`select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
                                 (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
                            from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' order by 1`);
  for (const t of tables) console.log(`[db-verify] table ${t.relname} owner=${t.owner} rls=${t.rls} force=${t.force_rls} policies=${t.policies}`);
  for (const name of REQUIRED_TABLES) if (!tables.some((t) => t.relname === name)) problems.push(`missing table ${name}`);
  for (const t of tables) if (t.relname !== 'schema_migrations' && !t.rls) problems.push(`RLS disabled on ${t.relname}`);

  const fks = await q(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint
                         where connamespace = 'public'::regnamespace and contype in ('f','u') order by 1, 2`);
  console.log(`[db-verify] foreign-key/unique constraints: ${fks.length}`);
  for (const f of fks) console.log(`[db-verify]   ${f.tbl}: ${f.def}`);
  const idx = await q(`select tablename, indexname from pg_indexes where schemaname = 'public' order by 1, 2`);
  console.log(`[db-verify] indexes: ${idx.map((i) => i.indexname).join(', ')}`);

  const migrations = await q(`select name, applied_at from schema_migrations order by name`);
  console.log(`[db-verify] migrations: ${migrations.map((m) => m.name).join(', ')}`);

  const grants = await q(`select grantee, count(*)::int as n from information_schema.role_table_grants
                           where table_schema = 'public' and grantee not in (current_user) group by grantee order by 1`);
  console.log(`[db-verify] other grantees on public tables: ${grants.map((g) => `${g.grantee}(${g.n})`).join(', ') || 'none'}`);
  if (grants.some((g) => g.grantee === 'PUBLIC')) problems.push('PUBLIC has privileges on application tables');

  const counts = await q(`select (select count(*) from users)::int as users, (select count(*) from devices)::int as devices,
                                 (select count(*) from sessions)::int as sessions`);
  console.log(`[db-verify] row counts: users=${counts[0].users} devices=${counts[0].devices} sessions=${counts[0].sessions}`);
} finally {
  await client.end();
}
if (problems.length) {
  console.error(`[db-verify] FAILED: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('[db-verify] OK');

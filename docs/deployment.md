# Deployment and environments

## Environments

| Vercel env | Database | `ONEAUTH_ORIGINS` | Migrations |
| --- | --- | --- | --- |
| Development (local) | local Postgres | not needed (localhost allowed) | `npm run db:migrate` |
| Preview (PR #1 branch) | **isolated preview database**, never production | `https://oneauth-git-claude-oneauth-foundation-gaqvr7-dakshgolani5-4632.vercel.app` (set, branch-scoped) | automatic on each preview build (`scripts/vercel-build.mjs`) |
| Production | separate `oneauth-production` Neon resource in Sydney | `https://oneauth-gamma.vercel.app` | administrative runner, before release |

Variables:
- `DATABASE_URL`: the **pooled** connection string used at runtime (Neon pooled host, or Supabase transaction pooler on port 6543).
- `DATABASE_URL_UNPOOLED` or `MIGRATION_DATABASE_URL`: the direct connection used for migrations (advisory locks need a session). Falls back to `DATABASE_URL`.
- `DATABASE_CA_CERT`: PEM, only if the provider's certificate doesn't chain to a public CA. TLS verification is always on for remote hosts.
- `ONEAUTH_ORIGINS`: comma-separated trusted origins. The first is canonical.
- `DATABASE_POOL_MAX`: per-instance pool size, default 3.

## Production release gate

The production resource is intentionally disconnected from the Vercel project
until migrations and the restricted login have been provisioned. Its owner URL
must be used only by an administrative runner, never as a deployed function
environment variable. A protected administration environment supplies
`MIGRATION_DATABASE_URL` (direct connection), `ONEAUTH_DB_APP_PASSWORD` (random,
at least 24 characters), and `ONEAUTH_RUNTIME_DATABASE_URL` (pooled connection
for `oneauth_app`). Do not print these values or commit them. Run:

```bash
npm ci
node scripts/migrate.mjs
node scripts/provision-app-role.mjs
node scripts/db-verify.mjs
node scripts/migrate.mjs
```

The second migration run proves repeatability. Test real tenant isolation and
denied DDL with the integration suite using a disposable database; the
production verifier checks role attributes, grants, schema, TLS, and an
unscoped runtime query without creating production accounts.

Configure only the pooled `ONEAUTH_RUNTIME_DATABASE_URL` as a Production
sensitive Vercel variable. Keep owner credentials in the administrative
environment. Set `ONEAUTH_DATABASE_ENV=production`,
`ONEAUTH_ORIGINS=https://oneauth-gamma.vercel.app`, and
`ONEAUTH_RP_ID=oneauth-gamma.vercel.app`. The RP ID cannot later be changed
without affecting passkeys created on this hostname. Deploy the reviewed
commit only after these checks, then run hosted passkey and pairing tests.

## Preview database (connected)

- **Neon** via the Vercel Marketplace, Free plan (`free_v3`, no payment method), store `neon-citrine-notebook`, region `syd1` (Sydney), Neon Auth off.
- The integration injected 16 variables (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`, `NEON_PROJECT_ID`) as *sensitive* for **Preview and Production**. **They were narrowed to Preview only.** Production has none.
- The store-level connection in Vercel still lists Production. **Owner action:** Vercel → Storage → `neon-citrine-notebook` → Projects → `oneauth` → environments: Preview only. Otherwise a future secret rotation may re-add Production variables. Even then, Production builds refuse to start (`ONEAUTH_DATABASE_ENV` guard).
- Functions run in `syd1`, next to the database (`vercel.json`).
- Preview builds: `migrate` → `preview-cleanup` (deletes only stale hosted-test accounts) → `db-verify` (credential-free report; fails the build on violated invariants).

## Hosted verification

Vercel SSO protects previews. Automated hosted tests need a **Protection Bypass for Automation** secret (Vercel → Project → Settings → Deployment Protection). One was created for the first hosted run, labelled *TEMPORARY … rotate after use*. Its value passed through an agent session, so **regenerate it** (which revokes the old one) and store the new value only as the GitHub Actions secret `VERCEL_AUTOMATION_BYPASS_SECRET`, plus `ONEAUTH_HOSTED_URL`. The agent's GitHub access can't write Actions secrets.

```bash
ONEAUTH_HOSTED_URL=https://oneauth-git-claude-oneauth-foundation-gaqvr7-dakshgolani5-4632.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=… npx playwright test -c playwright.hosted.config.ts
```

Or run the manual **Hosted preview verification** GitHub workflow after adding both values as repository secrets.

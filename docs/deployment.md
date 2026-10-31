# Deployment and environments

## Environments

| Vercel env | Database | `ONEAUTH_ORIGINS` | Migrations |
| --- | --- | --- | --- |
| Development (local) | local Postgres | not needed (localhost allowed) | `npm run db:migrate` |
| Preview (PR #1 branch) | **isolated preview database**, never production | `https://oneauth-git-claude-oneauth-foundation-gaqvr7-dakshgolani5-4632.vercel.app` (set, branch-scoped) | automatic on each preview build (`scripts/vercel-build.mjs`) |
| Production | not provisioned; don't create one yet | the real domain, once chosen | manual, deliberate |

Variables:
- `DATABASE_URL`: the **pooled** connection string used at runtime (Neon pooled host, or Supabase transaction pooler on port 6543).
- `DATABASE_URL_UNPOOLED` or `MIGRATION_DATABASE_URL`: the direct connection used for migrations (advisory locks need a session). Falls back to `DATABASE_URL`.
- `DATABASE_CA_CERT`: PEM, only if the provider's certificate doesn't chain to a public CA. TLS verification is always on for remote hosts.
- `ONEAUTH_ORIGINS`: comma-separated trusted origins. The first is canonical.
- `DATABASE_POOL_MAX`: per-instance pool size, default 3.

## Preview database: options assessed

| | **Neon** (via Vercel Marketplace) — recommended | Supabase (already installed) |
| --- | --- | --- |
| Cost | Free plan (`free_v3`), no payment method required | Free plan, no payment method required |
| Blocker | Not installed; needs your one-click install and terms acceptance | Your account already has its **2 active free projects** (in other organisations); creating a third was refused |
| Region | AWS `ap-southeast-2` (Sydney) | `ap-southeast-2` (Sydney) |
| Limits (per the Vercel Marketplace listing, Oct 2026) | 1 GB storage and 100 CU-hours compute per project, up to 2 CU; scale-to-zero, so expect a short cold start | 500 MB database, 5 GB egress; pauses after about 1 week idle |
| Vercel pooling | Pooled endpoint (PgBouncer) | Supavisor transaction mode, port 6543, IPv4 |
| TLS | Publicly trusted certificate, so verification works as-is | May need `DATABASE_CA_CERT` |
| Data API exposure | None | PostgREST exposes `public`; mitigated by migration 0002 |

Our SQL is plain Postgres 15+ and works on both. We don't use named prepared statements, so transaction pooling is safe.

## What you need to do (one of these)

**Option A: Neon (recommended)**
1. Vercel → team **dakshgolani5-4632's projects** → **Storage** → **Create Database** → **Neon** → accept the Free plan (no card).
2. Region **Sydney (aws-ap-southeast-2)**. Name it `oneauth-preview`.
3. Connect it to project **oneauth** with **only the Preview environment ticked** (untick Production and Development). Set the variable prefix to empty, so it creates `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
4. Optional but recommended: in the variable settings, limit the preview variables to the branch `claude/oneauth-foundation-gaqvr7`.
5. Tell me it's done. I redeploy the preview; the build applies migrations automatically, and I run the hosted suite.

**Option B: Supabase**
1. In the Supabase dashboard, pause or delete one of your two existing free projects (your choice).
2. Tell me, and I'll create `oneauth-preview` in Sydney and configure Preview-only variables.

## Hosted verification

Vercel SSO protects previews. Automated hosted tests need a **Protection Bypass for Automation** secret (Vercel → Project → Settings → Deployment Protection). I can create it with your go-ahead. It gives anyone holding it access to every preview of this project, so keep it in GitHub Actions secrets only.

```bash
ONEAUTH_HOSTED_URL=https://oneauth-git-claude-oneauth-foundation-gaqvr7-dakshgolani5-4632.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=… npx playwright test -c playwright.hosted.config.ts
```

Or run the manual **Hosted preview verification** GitHub workflow after adding both values as repository secrets.

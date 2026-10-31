# Technical architecture

## Stack (as implemented)

| Layer | Choice | Why |
| --- | --- | --- |
| Web | Next.js 16 App Router, React 19, TypeScript strict | Server Components keep authorisation and data access on the server; current Vercel-native stack |
| Styling | Tailwind CSS v4 with CSS-variable design tokens | Tokens drive both themes; no runtime CSS-in-JS |
| Primitives | Radix (via `radix-ui`) for dialogs | Accessible focus management and ARIA |
| Icons | lucide-react, plus custom brand mark | Consistent stroke icons; the brand is original SVG |
| Passkeys | `@simplewebauthn/server` + `/browser` v14 | Widely used, maintained WebAuthn library; we don't hand-roll attestation or assertion parsing |
| Database | PostgreSQL via `pg` with forward-only SQL migrations | Portable to Neon, Supabase or RDS; constraints and transactions do the heavy lifting |
| Sessions | Opaque 256-bit tokens in HttpOnly cookies, SHA-256 hash in DB | Instant server-side revocation; a DB leak doesn't yield usable tokens |
| QR | `qrcode` (SVG, generated client-side) | No third-party QR service sees pairing URLs |
| Tests | Vitest (unit and integration on real Postgres), Playwright (virtual WebAuthn authenticator), axe-core | Exercises the real verification path |

**Why not Supabase Auth or a hosted auth provider yet?** OneAuth's core product *is* device and session authority: custom scopes per device, pairing grants, and step-up rules. Hosted auth products cover passkey sign-in, but not delegated device grants with this lifecycle, and a split would put half the security model in someone else's tables. We use an established WebAuthn library and keep the session layer small and heavily tested. This decision should be revisited before scale and included in the external security review.

**Why no ORM?** The schema is small and security-critical. Explicit SQL makes ownership predicates (`where id = $1 and user_id = $2`) visible in review.

## Code layout

```
app/
  (marketing)/       landing, how-it-works
  (auth)/            signup, signin
  (app)/             authenticated shell: home, space, devices, cloud, account, welcome
  connect/           requesting device (unauthenticated)
  pair/[id]/         approving device
  api/               JSON route handlers (WebAuthn ceremonies, pairing, export, health)
lib/
  scopes.ts          permission model (shared with UI)
  plans.ts           configurable plan catalogue (no billing)
  server/            domain layer, no Next imports except request/auth/actions/http
    webauthn.ts      challenges, registration, login, step-up, passkey management
    sessions.ts      token issue, validation, revocation
    pairing.ts       pairing state machine
    devices.ts       device enrolment, listing, revocation
    account.ts       profile, export, deletion
    events.ts        append-only security log
    ratelimit.ts     Postgres fixed-window limiter
    auth.ts          getSession / requireSession(scope)
    actions.ts       server actions (each re-checks session and scope)
    http.ts          origin enforcement and error mapping for route handlers
db/migrations/       SQL migrations
proxy.ts             per-request nonce CSP
```

## Request flow and enforcement

1. `proxy.ts` sets a nonce-based CSP on every page.
2. Pages call `requirePageSession()`. Actions and routes call `requireSession(scope)`, which validates the cookie token in **one SQL statement** that checks revocation, expiry, idle timeout, device revocation and account status.
3. Every state-changing route handler goes through `jsonRoute()`, which rejects requests whose `Origin` isn't allow-listed (CSRF defence and WebAuthn origin binding). Server actions rely on Next's built-in Origin/Host check.
4. Every data query is scoped by `user_id` from the session, never by client-supplied ownership.

## Data model

See `db/migrations/0001_foundation.sql`. Tables: `users`, `user_profiles`, `authenticators`, `devices`, `sessions`, `device_pairing_requests`, `device_grants`, `webauthn_challenges`, `security_events`, `rate_limits`, `subscriptions`.

Planned tables, added only with their features: `files`, `folders`, `encrypted_vault_items`, `connected_providers`, `storage_usage`.

Row Level Security: not used, because the app connects as a single privileged role and enforces ownership in the domain layer (tested for cross-user access). If the database is ever exposed through PostgREST or Supabase client libraries, RLS policies become mandatory first.

## Pairing state machine

```
pending ──approve(code ok, step-up)──▶ approved ──claim(secret, once)──▶ claimed
   │                                     │
   ├─ approve(code wrong) ─▶ rejected     └─ claim window (2 min) passes ─▶ expired
   ├─ reject ─▶ rejected
   └─ 5 min passes ─▶ expired
```

## Deployment

- Vercel project `oneauth` (team `dakshgolani5-4632`), Git-connected to `daksh-07/OneAuth`. Preview deployments come from branches.
- Required env: `DATABASE_URL`. Optional: `ONEAUTH_ORIGINS`, `DATABASE_POOL_MAX`.
- Run migrations explicitly (`npm run db:migrate`) against each environment. They never run automatically during builds.
- Without `DATABASE_URL` the app still builds and serves public pages. Sign-up, sign-in and pairing show an honest "not available on this deployment" state, and `/api/health` returns 503.

## Observability (current and next)

- Current: structured JSON error logs that never include tokens or secrets; `/api/health`; the security event log per user.
- Next: an error-monitoring service (e.g. Sentry) with PII scrubbing, and log-based alerts on `auth.signin_failed` spikes and rate-limit hits.

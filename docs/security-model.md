# Security model

This describes what is implemented. It has **not** been independently reviewed. Automated tests show the controls behave as designed; they don't show the design is right, and they don't replace an external security audit. OneAuth must not hold real users' sensitive data until that audit is done.

## Assets
1. The ability to act as a user (sessions, step-up state).
2. The ability to enrol new devices into a user's account (pairing approval). This is the most valuable target.
3. Users' security history and device list (personal information, including IP addresses).
4. Future: encrypted file contents and keys (see [the Cloud proposal](proposals/cloud-encryption.md)).

## Authentication
- WebAuthn passkeys only, via `@simplewebauthn/server`. `userVerification: required` on every ceremony; registration rejects responses without the UV flag. OneAuth never receives biometric data.
- Discoverable credentials (`residentKey: required`). Attestation `none`.
- Signature counter regression is rejected and logged (`auth.signin_failed`). Many synced passkeys always report 0, so this only catches cloned *counting* authenticators.
- The returned `userHandle` must match the credential's user.
- A credential ID can belong to exactly one account. Re-registering one under a new account returns 409 and creates nothing (integration-tested).
- RP ID mismatch, tampered signatures, malformed responses, expired and replayed challenges are rejected (integration-tested). Replayed and malformed assertions are also rejected on the hosted preview.
- Challenges are server-generated and stored. They're consumed atomically once, are valid for 5 minutes, and are bound to purpose and origin; step-up and add-passkey challenges are also bound to the requesting session. A challenge is consumed *before* verification, so a failed attempt can't be retried with the same challenge.

## Relying-party origin
- Only origins listed in `ONEAUTH_ORIGINS` are trusted, plus localhost in development. Deployment hostnames are never trusted implicitly. Wildcards, paths, credentials and plain-http non-local origins are rejected (unit-tested).
- The RP ID is the hostname of the trusted origin. A passkey created on one hostname doesn't work on another, so **choose the production domain before inviting real users.**
- Page visits on any other hostname get a 307 to the first configured origin (verified on Vercel). API calls from other origins get a 403.

## Sessions
- 256-bit random token in an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-prefixed cookie (verified on the hosted preview by the hosted suite). Only `sha256(token)` is stored.
- One query enforces: not revoked, not expired, not idle for 7 days, device not revoked, account active.
- Lifetimes: owned passkey sign-in 30 days; shared-computer sign-in 8 hours; paired devices as granted (15 minutes to 30 days).
- Signing in again, or claiming a pairing, on a browser that already holds a session **revokes the previous session** (`replaced`).
- **Step-up ("sudo") window:** adding or removing passkeys and deleting the account require a passkey assertion within 5 minutes.
- **Transaction-bound approval:** approving a device requires a passkey assertion made *for that specific request*, by the same session, within 2 minutes, and consumes it. A general recent sign-in, a confirmation for another request, or another user's confirmation is rejected (integration-tested, with a mutation check).

## Authorisation
- Session scopes: `profile:read`, `devices:read`, `devices:manage`, `security:read`, `security:manage`. They're checked server-side in every page, server action and route handler.
- `security:manage` is never delegable to a paired device. Shared devices can be granted at most `profile:read` and `devices:read`.
- Only a *primary* (passkey) session on an *owned* device can approve or reject pairing, so there are no approval chains.
- Ownership is part of every `WHERE` clause. Cross-user (BOLA) attempts on sessions, devices, passkeys and step-up challenges are integration-tested, and the hosted suite checks that another user's device page renders no data.

## Pairing

| Threat | Control | Residual risk |
| --- | --- | --- |
| Someone sends the victim their QR/link ("scan to verify your account") | The approver must pick, from three options, the code shown on the requesting screen; a wrong pick rejects the request. A passkey confirmation is bound to the request. Defaults are minimal. Shared devices can never manage anything. | Reduced, not eliminated. See relay below. |
| **Real-time relay (QRLjacking):** a phishing page shows the attacker's live QR *and* its code | Network comparison; if networks differ, the user must tick "The device is in front of me and I started this myself", with a warning about websites, messages and callers. Warning copy on every approval. | **Open.** A determined user-deceiving relay still works. The proper fix is proximity proof (BLE or local-network handshake, as in CTAP hybrid) in the native apps. |
| "Same network" mistaken for proximity | The UI states that a network match is a hint, not proof, and that phones on mobile data usually differ. It's a heuristic: same IPv4, or same IPv6 /64. | NAT, VPNs and corporate networks make it unreliable either way. |
| Session donation: an attacker who sees a code approves the victim's device into the *attacker's* account | The requesting device shows "Connected to <name>'s OneAuth", with **This isn't my account** (sign out) before continuing. | Users may not read it. |
| Replay or race of an approved request | Claim is a conditional `UPDATE … WHERE status = 'approved'` with exactly one winner (concurrency-tested). The secret is held only in an `HttpOnly`, `SameSite=Strict` cookie. Claims are rate-limited. | — |
| Guessing request IDs or codes | IDs are UUIDv4. Codes are 8 characters from a 25-symbol alphabet (25⁸ ≈ 1.5×10¹¹, about 37 bits) and live 5 minutes. Code lookup is limited to 10 per 10 minutes per user. | Fine for this threat. Revisit if codes are ever reused for anything longer-lived. |
| Spoofed device name | Labelled "name reported by the device". | — |

## Compromised borrowed devices
OneAuth can't make a compromised computer safe. On a borrowed device with malware:
- Everything shown on screen can be captured.
- The session cookie can be stolen and replayed from elsewhere until it expires or is revoked. Revocation is immediate, but OneAuth can't detect the theft.
- Planned mitigations: shorter default temporary durations, Device Bound Session Credentials (DBSC) where browsers support them, and re-authentication for any future file access from shared devices.

## Web
- CSP with a per-request nonce and `strict-dynamic`; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`. Inline *styles* are allowed for Radix positioning. HSTS, `nosniff`, `X-Frame-Options: DENY`, COOP, a strict referrer policy and a restrictive Permissions-Policy are all served (verified on Vercel).
- CSRF: an allow-listed `Origin` is required on every JSON POST route (e2e-tested). Server actions use Next.js's Origin/Host check. Cookies are host-only.
- XSS: React escaping. The only `dangerouslySetInnerHTML` is the locally generated QR SVG of our own URL.
- Open redirect: `next=` must be a same-site path (unit-tested). The canonical redirect target comes only from configuration.
- Rate limits, held in Postgres so they work across instances: registration 10 per 15 minutes per IP; login options 30 per 15 minutes per IP; step-up 20 per 15 minutes per session; pairing creation 20 per 10 minutes per IP; claims 30 per 10 minutes per IP; code lookup 10 per 10 minutes per user. IP comes from `x-real-ip`, set by Vercel; it can be spoofed off-platform.

## Database: what's actually enforced
Measured on the Neon preview database by `scripts/db-verify.mjs` during the Vercel build:
- The runtime role is `neondb_owner`. It **owns every table**, has **`BYPASSRLS`**, and is a member of `neon_superuser`. On Vercel the same credentials exist at build time and at runtime.
- Consequently, **row-level security doesn't isolate tenants** for OneAuth's own queries. `FORCE ROW LEVEL SECURITY` wouldn't help either, because it doesn't apply to `BYPASSRLS` roles. A `SET ROLE` to a weaker role would be undone by `RESET ROLE` under SQL injection.
- **Tenant isolation is enforced by the application layer:** every query is scoped by the session's `user_id` in its `WHERE` clause; every entry point checks scopes. It's verified by:
  - integration BOLA tests;
  - the hosted suite, where user B tampers with their own server-action requests to target user A's device. The server refuses, and A's export shows no change;
  - a static test that fails if any SQL is built by string interpolation.
- What RLS (migration `0002`) does provide: every table has RLS enabled with no policies, and `PUBLIC`, `anon` and `authenticated` privileges are revoked. **Any other role is denied** (verified: no other grantees on application tables).
- TLS: verified client-side on Neon: TLSv1.3, certificate chain authorised. `sslmode` in URLs can't downgrade it.
- Migrations run on a direct (unpooled) connection under an advisory lock. Re-runs are idempotent (verified on a second preview build). Production builds refuse to run against a database without `ONEAUTH_DATABASE_ENV=production`.
- **To get database-enforced isolation later:** create a separate `NOBYPASSRLS` login role for the runtime with DML-only grants; keep owner credentials out of the runtime (migrations in a separate CI job); and add per-user policies driven by a transaction-local `oneauth.user_id`, with `SECURITY DEFINER` functions for the pre-authentication lookups (session token, credential ID, pairing secret). Tracked as a hardening item; it needs owner-provisioned credentials.

## Account deletion and data
- Deletion requires a fresh passkey assertion and typed confirmation. It cascades every user-owned row, including security events, and ends every session.
- Export contains everything except key material and token hashes.
- Retention: not yet defined. The proposal is 12 months for `security_events` (which hold IP addresses), and rate-limit rows are already pruned after a day.

## Known gaps, in priority order
1. Independent security review of `lib/server/{webauthn,sessions,pairing,devices}.ts`, `proxy.ts` and the schema.
2. Relay-resistant (proximity-bound) pairing.
3. Account recovery design (no staff back door).
4. Real-device testing of passkeys and QR flows (see [device testing](device-testing.md)).
5. Privacy policy, `security.txt`, incident response plan, retention jobs, error monitoring with PII scrubbing.
6. A not-found inside the app shell returns HTTP 200 (streamed skeleton) with not-found content. No data leaks (tested), but monitoring and crawlers see a 200.

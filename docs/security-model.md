# Security model

This describes what is implemented today. It has **not** been externally reviewed. Treat OneAuth as unsuitable for sensitive real-world data until it is.

## Assets
1. The ability to act as a user (sessions, step-up state).
2. The ability to enrol new devices into a user's account (pairing approval).
3. Users' security history and device list (personal information).
4. Future: encrypted file contents and their keys.

## Authentication
- WebAuthn passkeys only. `userVerification: required` on every ceremony, so the authenticator must perform a biometric or PIN check. OneAuth never receives biometric data.
- Discoverable credentials (`residentKey: required`) allow username-less sign-in.
- Attestation `none`: we don't restrict authenticator models.
- Signature counter is enforced: a regression is rejected and logged (`auth.signin_failed`).
- Returned `userHandle` must match the credential's user.
- Challenges: server-generated, stored in `webauthn_challenges`, consumed atomically once, valid 5 minutes, bound to purpose, origin and (for step-up and add-passkey) the requesting session.

## Sessions
- 256-bit random token in an HttpOnly, `SameSite=Lax`, `Secure` (production), `__Host-` prefixed cookie. Only `sha256(token)` is stored.
- Validation in one query enforces: not revoked, not expired (absolute), not idle (7 days), device not revoked, account active.
- Lifetimes: owned passkey sign-in 30 days; shared-computer sign-in 8 hours; paired devices as granted (15 minutes to 30 days).
- **Step-up**: sensitive actions require a passkey assertion within the last 5 minutes (`sessions.reauth_at`): adding or removing passkeys, deleting the account, and approving a device (always re-prompted in the UI).
- Session fixation: sessions are always created fresh. Device keys are never reused across accounts, after revocation, or across owned/shared kinds.

## Authorisation
- Scopes per session: `profile:read`, `devices:read`, `devices:manage`, `security:read`, `security:manage`.
- Passkey sign-in on an owned device gets all scopes. Shared sign-in gets `profile:read` and `devices:read`.
- Paired owned devices can be granted up to `devices:manage` and `security:read`. Paired shared devices can be granted up to `devices:read`. **`security:manage` is never delegable.**
- Only a *primary, owned* session with `devices:manage` can approve or reject pairing. This prevents approval chains from paired or shared devices.
- All ownership checks are in SQL `WHERE` clauses (`id = $1 and user_id = $2`). Integration tests cover cross-user (BOLA) attempts on sessions, devices and passkeys.

## Pairing threats and controls

| Threat | Control |
| --- | --- |
| Attacker sends victim their own QR/link ("approve this to verify your account") | Approver must pick the code shown on the requesting screen from three options; a wrong pick rejects the request. Same/different-network signal. Explicit warning text. Passkey step-up. Minimal default scopes. Shared devices can never get management scopes. |
| Attacker relays the code too (real-time phishing) | **Residual risk.** Code matching doesn't stop an attacker who tells the victim the code. Proximity proof (BLE or local-network handshake, as in CTAP hybrid transport) is the planned fix in the native app phase. |
| Replay of an approved request | Claim is a conditional `UPDATE … WHERE status='approved'`: exactly one winner (tested with concurrent claims). Requester secret lives only in an HttpOnly `SameSite=Strict` cookie. |
| Guessing request IDs or codes | IDs are UUIDv4. Codes are about 37 bits, live 5 minutes, and lookup by code is rate-limited per user (10 per 10 minutes). |
| Stale approvals | Pending requests live 5 minutes. After approval the requester has 2 minutes to claim. |
| Spoofed device name | Labelled "name reported by the device" in the UI. |

## Web security
- CSP with per-request nonce and `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. Inline *styles* are allowed (Radix positioning).
- `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, HSTS, COOP, restrictive Permissions-Policy.
- CSRF: allow-listed `Origin` is required on every JSON POST route. Server actions use Next's Origin check. Cookies are `SameSite=Lax` (pairing cookie `Strict`).
- XSS: React escaping. The only `dangerouslySetInnerHTML` is the locally generated QR SVG from our own URL.
- Open redirects: `next=` must be a same-site path (`lib/safe-next.ts`, unit-tested).
- Input validation: lengths and enums at the domain layer and database `CHECK` constraints.
- Rate limits (Postgres-backed, cross-instance): registration 10 per 15 minutes per IP, login options 30 per 15 minutes per IP, step-up 20 per 15 minutes per session, pairing creation 20 per 10 minutes per IP, code lookup 10 per 10 minutes per user.

## Logging and privacy
- `security_events` stores type, device, session, IP and user agent. It never stores tokens, challenges, keys or credential material.
- Server error logs include only the error name and message, never request bodies.
- Account deletion cascades every user row, including security events. Export returns everything except key material and token hashes.
- **Open item:** a retention period for `security_events` and `rate_limits` is not yet defined (proposal: 12 months for events, rate-limit rows purged after 1 day).

## Known gaps (release blockers before handling sensitive data)
1. External security review of auth, session and pairing code.
2. Account recovery design: must not create a staff back door.
3. Cloud key hierarchy (per-device keys wrapped by a user key, rotation on device revocation) designed and reviewed before any file storage.
4. Proximity-bound pairing for real-time relay phishing.
5. Privacy policy, data retention policy, vulnerability disclosure policy (`security.txt`), incident response plan, Australian Privacy Act (APP) assessment.
6. Error monitoring with PII scrubbing.

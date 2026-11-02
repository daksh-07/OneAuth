# Phase 2D internal security audit

_2 November 2026; branch `security/phase-2d` from PR #2 `abd324d4c80cd43424e60b8ed10154d585e82908`. Internal review only. Findings describe the reviewed commit and this branch's changes, not an independent certification._

## Executive decision

Identity and Cloud have substantial automated security coverage. Cloud remains a **test-data-only Preview prototype**. Production authentication is unavailable, the transition proof has a known collusion failure, physical passkeys are untested and there is no independent cryptographic approval. No PR merge, Production Cloud flag, paid object store or production DB change is authorised by this audit.

## Method and evidence

Reviewed the required design/status/device documents, `lib/vault/{crypto,trust,rotate,keystore,client}.ts`, `lib/server/cloud/*`, migrations 0001–0007, auth/API wrappers, CSP proxy and workflows. Compared implementation with design claims. A controlled integration fixture constructs a forged transition with a removed old-key holder. No destructive scan or customer data was used.

At the PR #2 head, GitHub CI run `41424192020` was green: 213 Vitest tests in 17 files, 46 Playwright tests, TypeScript, lint and build. A Vercel Preview deployment of exactly `abd324d` is READY; its health returned HTTP 200 with current schema and least-privilege role. The previously reported hosted 9/9 result has **not** been independently rerun here. On this branch, TypeScript, lint and the Next.js production build passed; the error-redaction unit test passed in a DB-free local configuration. `npm audit --omit=dev` reported zero advisories on 2026-11-02. Full integration and browser tests require CI/PostgreSQL; this workspace has no local Postgres. These are separate evidence levels.

## Findings

| ID | Severity | Finding and root cause | State |
| --- | --- | --- | --- |
| C1 | **Critical for real-data release** | A removed device retaining outgoing VK can collude with a DB-writing server to forge the HMAC transition proof. `verifyResume` accepts the planted next key, permitting a remaining browser to rewrap file keys. HMAC proves knowledge of VK, not active-device authorisation. Existing tests covered a DB writer *without* VK; Phase 2D adds the collusion fixture. | **Open, Preview only.** Requires protocol design, compatibility plan and independent review. |
| H1 | High architectural | Malicious same-origin JavaScript from compromised deployment or XSS can use IndexedDB DK and read unlocked VK/plaintext. Browser-delivered E2EE cannot claim otherwise. CSP and non-extractability reduce narrower attacks. | Open, accurately documented. |
| H2 | High operational | A temporary Vercel automation bypass remains listed while the hosted workflow expects the repository secret. The GitHub connector cannot update Actions secrets, so rotating Vercel alone would break authorised hosted CI. | Open; coordinated owner-only rotation/revocation required. |
| M1 | Medium | Unexpected API exceptions were logged with raw `err.message`, which can contain driver connection details, SQL fragments or request data. | Fixed on this branch: log a fixed category without error message or name; sentinel regression test passed. |
| M2 | Medium | CI used mutable major tags for three GitHub Actions. A compromised upstream tag could alter the build. | Fixed on this branch: checkout, setup-node and upload-artifact use full commits resolved from v5 tags on 2026-11-02; new CI execution pending. |
| M3 | Medium architectural | Browser commitment pins disappear with site-data eviction; a first-use browser or cleared site relies on human confirmation/recovery. The transition proof is insufficient when old VK is compromised. | Open; release claims must be conditional. |
| L1 | Low | `docs/security-model.md` retained old preview-owner-role wording, while current code and health use a restricted runtime role. | Corrected on this branch. |

Counts: **1 critical, 2 high, 3 medium, 1 low**. They are scoped to release risk, not a claim that exploitation occurred. The raw-log fix does not repair C1.

## Cryptography review notes

OAC1 authenticates the full header, file UUID and chunk index as AAD, and rejects truncation, extension and wrong IDs. AES-GCM uses 96-bit random nonces under a fresh file key. AES-KW wraps random keys; JWE uses `jose` ECDH-ES+A256KW/A256GCM and an authenticated version header. HKDF labels separate names, Space, recovery, recovery proof and transitions. Recovery has 256 random bits and a checksum, not a password. The server cannot verify a submitted envelope represents the real vault key; the client's old-key proof and human code comparison are the actual trust checks. The old-key proof fails under C1. Non-extractable DK in IndexedDB can still be used by same-origin malicious script. Deep rotation only protects old ciphertext after completion, and provider backups can retain prior ciphertext.

The source review is not a complete formal proof of nonce uniqueness, key lifecycle or crash safety. Independent review must assess compatibility, recovery and loss of all trusted devices before altering the protocol.

## API, database and storage review notes

`jsonRoute` requires a configured trusted Origin, and `readRoute` rejects cross-site Fetch Metadata; private responses are no-store. Passkey, pairing, BOLA, replay, revoked-device and rate-limit cases have integration and browser coverage in CI, but there was no fresh hosted penetration run in this phase. RLS policies cover the sensitive tables under the restricted runtime role; `asUser` uses a transaction-local GUC and rolls back before releasing pooled connections. SQL remains parameterised. The runtime can set its own custom GUC, so RLS is a second boundary against missing predicates, **not** a defence against arbitrary SQL execution as `oneauth_app`.

The Postgres Preview driver checks server-counted bytes and SHA-256 before settling quota. Row and tree locks address concurrent operations; tests cover interrupted uploads and rotations. SHA-256 on server-supplied ciphertext detects storage corruption, while client AEAD authenticates content. `S3/R2` is unimplemented; no paid resource was provisioned. Run migration interruption/replay tests and production restricted-role verification in the separate identity task; this review did not touch its DB.

## Infrastructure and browser limits

Vercel Preview has a distinct Neon resource and is READY. Production remains on the older deployment; its health is 503 without a runtime DB. Cloud's guard refuses Production even if a flag is accidentally set. WebAuthn RP ID must match the final hostname. CSP uses nonce plus strict-dynamic, no object embedding or framing, and HTTPS HSTS; extension/script compromise remains. Downloads use `application/octet-stream`; encrypted names are sanitised. Sign-out retains a browser DK by design; “Remove this browser” removes it. Clipboard recovery-key copy and text export are explicit user actions and should be tested on physical devices. No real biometric or OS storage-eviction result is claimed.

## Next release-blocking work

1. Redesign C1 with an independent authorisation anchor; review migration, resumption, recovery and single-device fallback externally before real data.
2. Obtain specialist protocol/application review at a pinned commit (package linked above), then retest findings.
3. Finish production identity in its separate task, run hosted passkey/pairing tests and physical-device checklist.
4. Coordinate bypass-secret rotation with GitHub Actions secret update; verify old token rejects and hosted CI still passes.
5. Verify the pinned CI actions in the new PR, then implement and audit a storage driver before any R2 purchase or large-file release; define monitoring, incident and retention procedures.

See `release-gates.md` for exact pass/fail status and `independent-review-package.md` for reviewer scope.

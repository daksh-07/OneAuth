# OneAuth: implementation status

_Last updated: 2 November 2026._

**Status labels:**

- **Implemented and verified:** code exists and automated tests exercise it.
- **Implemented, unverified:** code exists, but it hasn't been checked in the stated environment.
- **Designed only:** written design, no code.
- **Not started.**
- **Blocked:** waiting on someone or something outside this work.

## Branches

| Branch | Head | Purpose | PR |
| --- | --- | --- | --- |
| `claude/oneauth-foundation-gaqvr7` | `fccc9fc` | Phase 1 identity foundation | #1 (open, not merged) |
| `claude/oneauth-cloud-foundation` | see the PR | Cloud developer preview, Space foundation, API and native docs (stacked on the branch above) | Stacked PR into the foundation branch |

## Phase 1: identity foundation

| Feature | Status | Evidence |
| --- | --- | --- |
| Passkey sign-up, sign-in, step-up, added passkeys (UV required) | Implemented and verified | Integration plus E2E with Chrome's virtual authenticator; hosted preview run (PR #1) |
| Opaque sessions, `__Host-` cookies, scopes | Implemented and verified | Integration and E2E tests |
| QR and code device pairing; remote-network typed code; limited remote scopes | Implemented and verified | `tests/integration/pairing.test.ts`, E2E journeys |
| Rate limits that survive rolled-back transactions | Implemented and verified | Integration tests |
| Least-privilege runtime role with RLS tenant isolation | Implemented and verified | `tenant-isolation.test.ts`; `db-verify.mjs` in every build |
| Shared-device behaviour, new-device alert | Implemented and verified | Integration and E2E tests |
| Physical-device biometric testing | **Not started** | Needs real hardware (`docs/device-testing.md`). No hardware results are claimed. |
| Production deployment | **Blocked** | `https://oneauth-gamma.vercel.app/api/health` returns 503 `database: not_configured`. The production database setup is owned by the separate task and the owner (pending Neon activation); not touched here. |

## OneAuth Cloud (developer preview, test files only)

| Feature | Status | Notes |
| --- | --- | --- |
| Security design (keys, enrolment, recovery, format, threat model) | Implemented as written design; **not independently reviewed** | `docs/cloud/security-design.md` §11 lists the review items. |
| Browser cryptography (OAC1 chunks, AES-KW file keys, JWE device envelopes, recovery key and proof) | Implemented and verified | 20 unit tests, including tampering at every header byte, truncation, reordering and wrong keys. |
| File and folder database model, RLS | Implemented and verified | Migration `0004`; cross-user tests. |
| Storage abstraction | `postgres` driver: implemented and verified. `s3`/R2 driver: **designed only** | R2 isn't provisioned (it's a paid-service decision). Parts are 1 MiB, well under Vercel's request-body limit. |
| Permission enforcement | Implemented and verified | Owned primary passkey sessions only; active vault device for content; step-up for vault, approval, recovery and revocation. |
| Quota (reserve, settle, release; race-safe) | Implemented and verified | Concurrency test; the client is never trusted for byte counts. |
| Upload state (uploading/ready, integrity check, cancel releases quota) | Implemented and verified | Integration tests for hash mismatch, wrong part size and over-declaration. |
| Cloud UI (setup, recovery key, approval with fingerprint, file browser, trash, favourites, storage meter, vault access) | Implemented and verified locally | E2E on desktop Chromium; visual, overflow and touch-target checks at mobile and desktop sizes. |
| **End-to-end encrypted transfer between two authorised browsers** | Implemented and verified locally (behind the preview flag) | E2E: browser A encrypts a 1.6 MB file; B is approved after the codes are compared; B downloads it and the bytes match; the database holds no plaintext; removing access is enforced. Runs only under `ONEAUTH_CLOUD_PREVIEW=1`, never on Vercel production. |
| Vault-key rotation after revocation | **Designed only** | A revoked browser keeps anything it already downloaded. |
| Padmé size padding, client-side malware scanning | **Not started** | |

## OneAuth Space

| Feature | Status |
| --- | --- |
| Workspace model, per-device selection, at least one space | Implemented and verified (migration `0005`, integration tests) |
| Switcher, create, settings (name, type, colour) | Implemented and verified (E2E) |
| Device-specific visibility, enforced server-side | Implemented and verified (integration tests across two devices) |
| Pinned Cloud files and folders (names decrypted in the browser) | Implemented and verified (E2E) |
| Bookmarks, service shortcuts, synced preferences | **Not started** (shown in the UI as "Planned") |

## Mobile and integrations

| Item | Status |
| --- | --- |
| API contract for existing routes | Documented (`docs/api/contracts.md`); routes are not yet versioned. |
| Native architecture (Secure Enclave and Keystore keys, DPoP tokens, Rust core) | **Designed only** (`docs/native/architecture.md`) |
| Token endpoint, DPoP, push approvals | **Not started** |

## Validation on this branch (local)

- `tsc --noEmit`: clean. `eslint .`: clean.
- Vitest: 172 tests (unit and PostgreSQL integration, running as the least-privilege role).
- Playwright: 46 tests across desktop Chromium, iPhone WebKit, Android Chromium, Firefox and desktop WebKit, including axe accessibility, light and dark themes, no horizontal overflow, and touch targets.
- `next build`: succeeds.
- Hosted preview: see the PR for the current result.

## Security concerns still open

1. No independent cryptographic review (blocks real data).
2. Browser-delivered E2EE trusts the served JavaScript; there's no code transparency yet.
3. A 40-bit fingerprint is adequate only because a person compares it; this is a review item.
4. Revoked devices aren't cryptographically cut off until vault-key rotation exists.
5. Preview and production share one Vercel project. Preview deployments share one preview database, and migrations `0004` and `0005` are additive, so PR #1's preview keeps working.

## Next actions

1. Owner: finish production database activation (the other task), then decide on promoting PR #1.
2. Independent review of `docs/cloud/security-design.md` (§11 checklist) before any real data.
3. Physical-device runs from `docs/device-testing.md`.
4. Decide on R2 (paid) before files larger than the preview limit.
5. Vault-key rotation; then the token endpoint and native prototypes.

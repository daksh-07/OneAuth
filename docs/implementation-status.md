# OneAuth: implementation status

_Last updated: 2 November 2026 (Phase 2B)._

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
| **End-to-end encrypted transfer between two authorised browsers** | Implemented and verified locally **and on the hosted Vercel + Neon preview** (behind the preview flag) | E2E: browser A encrypts a 1.6 MB file; B is approved after the codes are compared; B downloads it and the bytes match; the database holds no plaintext; removing access is enforced. Runs only under `ONEAUTH_CLOUD_PREVIEW=1`, never on Vercel production. |
| Phase 2B self-review fixes F1–F10 | Implemented and verified | `security-design.md` §12; a regression test for each finding. This is a self-review, **not** an independent audit. |
| Vault-key rotation (staged: start → re-wrap → commit or abort; resumable by any approved browser) | Implemented and verified, **preview only; design not independently reviewed** | `docs/cloud/key-rotation.md`; `key-rotation.test.ts` (6 scenarios); E2E through the UI. It protects material added afterwards, not what a removed browser already downloaded. |
| Deep rotation (re-encrypting existing contents) | **Designed only** | Needs the S3/R2 driver to be practical. |
| Search, sort, drag-and-drop, retryable transfers, Move to…, "Remove this browser" | Implemented and verified (E2E) | |
| Padmé size padding, client-side malware scanning | **Not started** | |

## OneAuth Space

| Feature | Status |
| --- | --- |
| Workspace model, per-device selection, at least one space | Implemented and verified (migration `0005`, integration tests) |
| Switcher, create, settings (name, type, colour) | Implemented and verified (E2E) |
| Device-specific visibility, enforced server-side | Implemented and verified (integration tests across two devices) |
| Pinned Cloud files and folders (names decrypted in the browser) | Implemented and verified (E2E) |
| Bookmarks and shortcuts, end-to-end encrypted, only http(s) links rendered | Implemented and verified (integration plus E2E) |
| Per-space preferences (Cloud sort, links in a new tab) | Implemented and verified |
| Sync between approved browsers (20-second refresh, refresh on focus, conflict-safe edits) | Implemented and verified (conflict test; flagship E2E) |
| Permission-aware content (locked counts for unapproved browsers; device-restricted spaces) | Implemented and verified |
| Service sign-in, account-wide preferences, bookmark import | **Not started** (shown as "Planned") |

## Mobile and integrations

| Item | Status |
| --- | --- |
| API contract for existing routes | Documented (`docs/api/contracts.md`); routes are not yet versioned. |
| Native architecture (Secure Enclave and Keystore keys, DPoP tokens, Rust core) | **Designed only** (`docs/native/architecture.md`) |
| Token endpoint, DPoP, push approvals | **Not started** |

## Validation on this branch (local)

- `tsc --noEmit`: clean. `eslint .`: clean.
- Vitest: 196 tests (unit and PostgreSQL integration, running as the least-privilege role).
- Playwright: 46 tests across desktop Chromium, iPhone WebKit, Android Chromium, Firefox and desktop WebKit, including axe accessibility, light and dark themes, no horizontal overflow, and touch targets.
- `next build`: succeeds.
- Hosted preview (`oneauth-git-claude-oneauth-cloud-foundation-…vercel.app`, commit `b064d44`): health `ok` / schema `current` / `least_privilege`. Hosted Playwright **8/8**, including `tests/hosted/cloud.spec.ts`: a two-browser encrypted transfer with byte-identical download, against real Vercel functions and the Neon preview database. Throwaway accounts were deleted.
- PR #1's preview stays healthy on the shared preview database after migrations `0004` and `0005`.
- Phase 2B: the flagship two-browser journey (`tests/e2e/cloud.spec.ts`) passes locally. Hosted results for the Phase 2B head are in the PR.

## Security concerns still open

1. No independent cryptographic review (blocks real data).
2. Browser-delivered E2EE trusts the served JavaScript; there's no code transparency yet.
3. The 60-bit security code relies on a person actually comparing it; this is a review item.
4. Rotation doesn't re-encrypt existing contents: a removed browser that kept the old vault key can derive existing file keys if it ever gets the ciphertext (deep rotation is designed only).
5. Preview and production share one Vercel project. Preview deployments share one preview database, and migrations `0004` and `0005` are additive, so PR #1's preview keeps working.

## Next actions

1. Owner: finish production database activation (the other task), then decide on promoting PR #1.
2. Independent review of `docs/cloud/security-design.md` (§11 checklist) before any real data.
3. Physical-device runs from `docs/device-testing.md`.
4. Decide on R2 (paid) before files larger than the preview limit.
5. Review sign-off on `key-rotation.md` §8, then deep rotation and the token endpoint.

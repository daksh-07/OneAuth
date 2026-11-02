# OneAuth release gates — 2 November 2026

Evidence means the stated check was observed on the named environment. A local/CI pass does not imply physical-device or independent cryptographic approval.

| Area | Gate | Status | Evidence / required closure |
| --- | --- | --- | --- |
| Identity | Production DB and restricted login | **Failed** | Production health 503; separate Sydney Neon resource has migrations 0001–0003, but `oneauth_app` is NOLOGIN and no Production runtime URL is configured. Owned by the separate authentication task. |
| Identity | Hosted registration, passkey sign-in, pairing, revocation | **Blocked** | Do not release until restricted DB role and hosted security checks pass on the production origin. |
| Identity | Real Face ID, Touch ID, Android biometrics, Windows hybrid | **Not tested** | Founder physical-device checklist in `docs/device-testing.md`; capture OS/browser, prompt and outcome. |
| Identity | Account recovery and relay-resistant pairing | **Blocked** | No account recovery; pairing relay risk remains. |
| Cloud | AES-GCM framing, AAD, wrapping and recovery primitives | **Passed with evidence (automated, conditional)** | PR #2 CI run 41424192020: 213 Vitest tests, 46 Playwright tests. Assumes genuine served JS and uncompromised browser. |
| Cloud | Forged transition with removed-device/server collusion | **Failed** | Phase 2D fixture demonstrates a valid old-key HMAC can be forged by a removed holder. Redesign and independent approval required. |
| Cloud | Recovery, rotation and deep-rotation protocol approval | **Requires independent approval** | Internal tests only; `docs/security/independent-review-package.md` gives review scope. |
| Cloud | Real personal files | **Blocked** | Preview flag only; production guard in `lib/server/cloud/access.ts`; no paid R2 provisioned. |
| Cloud | Storage integrity, quota and interrupted upload | **Passed with evidence (preview test data)** | CI integration/E2E; Postgres preview driver only. Provider backup and deletion claims remain limited. |
| Cloud | S3/R2 multipart and presigned URLs | **Not tested** | Driver not implemented. No paid service approved. |
| Infrastructure | CI at reviewed PR #2 head | **Passed with evidence** | `abd324d4c80cd43424e60b8ed10154d585e82908`, CI run 41424192020, typecheck/lint/213 tests/build/46 browser tests succeeded. This hardening branch needs its own CI. |
| Infrastructure | Least-privilege preview runtime | **Passed with evidence** | Preview health 200 reports `runtime_role:least_privilege`; direct production role still NOLOGIN. |
| Infrastructure | Temporary automation bypass removed or rotated | **Blocked** | Vercel control still lists a bypass. Hosted workflow depends on `VERCEL_AUTOMATION_BYPASS_SECRET`; GitHub connector cannot update Actions secrets. Preserve CI, rotate both ends through owner-only secure UI. |
| Infrastructure | Action pinning and dependency review | **Blocked** | This branch pins checkout, setup-node and upload-artifact to full commits; CI and dependency alert review remain pending. |
| Infrastructure | Rollback, monitoring and incident response | **Not tested** | Vercel deployment rollback exists, but incident runbook, PII-scrubbed alerts and recovery drills are not validated. |
| Product | Desktop/mobile emulation, axe, reduced-motion layouts | **Passed with evidence (simulator)** | CI Playwright 46 tests on Chromium/WebKit/Firefox and mobile emulation. No real-device claim. |
| Product | Privacy claims and recovery instructions | **Blocked** | Must state browser-JS trust, lost-key irrecoverability, metadata, backups, and removed-device limits in user-facing terms before real data. |

**Decision:** Identity production remains unavailable; Cloud is **not eligible for real data**. Do not merge PR #1 or #2, enable Cloud Production, or promote the security branch solely on automated tests.

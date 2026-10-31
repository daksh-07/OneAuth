# Roadmap

Each phase ships only with passing tests and acceptance criteria. Nothing is described as complete until it is.

| Phase | Scope | Status |
| --- | --- | --- |
| 0. Audit | Repository, Vercel and services audit; architecture; threat model | ✅ Done |
| 1. Web foundation | Brand, design system, landing, passkey auth, shell, dashboard, devices, settings, real DB | ✅ Done (pending a production database) |
| 2. Device pairing | QR pairing, approval, scopes, expiry, revocation | ✅ Done (web-to-web) |
| 3. Encrypted cloud | Key hierarchy, recovery, client-side encryption, R2 storage, quotas | ◻︎ Design next |
| 4. Native approval | iOS and Android apps, Secure Enclave and Keystore device keys, push approvals, in-app scanner, proximity-bound pairing | ◻︎ |
| 5. Continuity | Desktop companion, external file providers, supported credential providers, workspace sync | ◻︎ |
| 6. Commercial | Hospitality pilots, smart-TV SDKs, enterprise policy, developer API, billing | ◻︎ |

## Next milestone (highest priority)

**Provision production infrastructure and get an external review of the identity core.**
1. Provision Postgres (Neon via the Vercel Marketplace, or Supabase) for Preview and Production, set `DATABASE_URL`, and run migrations.
2. Verify the preview end-to-end on real iPhone and Android hardware (passkeys and cross-device QR).
3. Add error monitoring, `security.txt`, a privacy policy and retention jobs.
4. Commission a security review of `lib/server/{webauthn,sessions,pairing}.ts`.

Then **Phase 3 design**: a written key-management and recovery spec (per-device X25519 keys, a user master key wrapped per device, recovery-kit and social-recovery options without a staff override), reviewed before any implementation.

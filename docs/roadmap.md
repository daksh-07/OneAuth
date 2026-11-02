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

**Hosted, verified identity core ready for controlled testing.**
1. ✅ Explicit origin pinning, bound approvals, RLS lock-down, verified TLS, cross-browser coverage, hosted test suite.
2. ◻︎ Preview database (owner action: see [deployment](deployment.md)). The preview build then migrates automatically.
3. ◻︎ Run the hosted suite and the [physical device matrix](device-testing.md).
4. ◻︎ Error monitoring, `security.txt`, privacy policy, retention job.
5. ◻︎ Independent security review of the identity core.

Then **Phase 3:** review the [Cloud encryption proposal](proposals/cloud-encryption.md). Its SAS-derived pairing codes (§4) are worth building first, because they strengthen pairing even before Cloud.

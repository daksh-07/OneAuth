# OneAuth Cloud: which guarantees are actually enforced

_Phase 2C inventory. This is a **self-review, not independent cryptographic approval**. It checks the code against the design. Cloud remains a developer preview for test files only and is off on production._

**Enforcer:**
- **DB**: PostgreSQL constraints and row-level security, using the least-privilege runtime role.
- **Server**: application checks in `lib/server`.
- **Client**: browser code in `lib/vault`. It protects the user even against the server, but only if the served JavaScript is genuine.
- **User**: depends on a person comparing codes.

**Status:**
- **Enforced and tested**
- **Partial**: enforced, with a stated gap
- **Not enforced**

## Confidentiality

| Guarantee | Enforcer | Where | Test | Status / limits |
| --- | --- | --- | --- | --- |
| File contents, names, folder names, bookmarks and shortcuts are encrypted before upload | Client | `lib/vault/crypto.ts`, `client.ts` | Unit tests; E2E checks the stored bytes contain no plaintext | Enforced and tested. **Depends on the served JavaScript** (no code transparency) |
| Only approved ("active") browsers receive content, wrapped keys or envelopes | Server | `requireActiveVaultDevice` on every Cloud and Space content route | `cloud.test`, `cloud-adversarial.test`, hosted adversarial | Enforced and tested |
| Other accounts can't reach a user's rows | DB + Server | RLS `tenant_rows` on every table; `db-verify` in each build | `tenant-isolation`, cross-account tests in every suite, hosted | Enforced and tested |
| A removed browser gets nothing more from the server | Server | Revocation clears envelopes; refused at every route | Integration, E2E, hosted | Enforced and tested |
| A removed browser can't decrypt **files added after** a key replacement | Client (crypto) | Rotation: the new vault key goes only to active browsers | `key-rotation.test`, E2E | Enforced and tested, **once the user replaces the key** (offered, not automatic) |
| A removed browser can't decrypt **existing** files if the ciphertext leaks | Client (crypto) | Deep rotation re-encrypts contents | `deep-rotation.test`, E2E | Enforced and tested **after re-encryption**. Until the user runs it, the kept file keys still work. Files whose ciphertext fails authentication can't be re-encrypted |
| Data already downloaded by a removed browser | none | n/a | n/a | **Not enforceable** by any system. Stated in the UI |

## Integrity and key trust

| Guarantee | Enforcer | Where | Test | Status / limits |
| --- | --- | --- | --- | --- |
| Tampered, reordered, truncated or swapped content fails | Client | OAC1 AEAD with header, file ID and index in the AAD | Unit (every header byte), E2E (storage corruption) | Enforced and tested |
| Stored size and hash match what was declared | Server | `completeUpload` | Integration, hosted | Enforced and tested (transport and storage check, not authenticity) |
| The approver encrypts to the right browser | User + Client | 60-bit security code computed locally on both screens | Integration, E2E, hosted | Partial: relies on the user comparing |
| A newly approved browser got the approver's key, not one the server injected (G5) | User + Client | Confirmation code from the received key; the browser stays read-only until confirmed | `key-trust.test`, E2E, hosted | Partial: relies on the user comparing |
| A browser never accepts an **older** vault key (rollback, G1) | Client | Version in the authenticated JWE header; local pins in IndexedDB | `key-trust.test` | Enforced and tested **after the browser has unlocked once**. Clearing site data resets the pins |
| A browser never accepts a **different key for a known version** | Client | Commitment pins | `key-trust.test` | Enforced and tested (same caveat) |
| A browser accepts a **new** version automatically only with a valid transition proof | Client | HMAC under the outgoing key; non-extractable verification key stored per version | `key-trust.test` | Enforced for one-step transitions. Multi-step, or a browser that never pinned the previous version, falls back to the confirmation code. **A removed browser colluding with the server** could forge a proof for the step it knew |
| Resuming an interrupted rotation can't be hijacked by a planted rotation | Client | `verifyResume` before any re-wrapping | `key-trust.test` | Enforced and tested (same collusion caveat) |
| Recovery returns the genuine vault key | Client | AES-KW under a key derived from the recovery key (authenticated) | Unit, integration | Enforced and tested |
| Only someone with the recovery key can activate a browser through recovery | Server | Proof checked against the stored SHA-256 verifier | Integration | Enforced and tested |
| A recovery key that a removed browser may have seen isn't kept | Server | `recovery_replacement_required` policy | `key-trust.test` | Enforced and tested. Detects only use through the recovery flow, not the key being typed elsewhere |

## Availability and accounting

| Guarantee | Enforcer | Where | Test | Status |
| --- | --- | --- | --- | --- |
| Quota can't be exceeded, even concurrently | Server + DB | Locked reservation | Concurrency test | Enforced and tested |
| Abandoned uploads release their reservation | Server | 24h expiry under the usage lock | Adversarial test | Enforced and tested |
| Folder tree stays acyclic; no file lost to a concurrent folder delete | Server | Advisory lock; one lock order | Concurrency tests | Enforced and tested |
| Rotation and deep rotation never leave the vault half-switched | Server + DB | Single-transaction commit or swap; staged `next_*` / `replaces_file_id` | Interruption tests | Enforced and tested |

## Not provided (by design or not yet)

- **Protection against malicious JavaScript served by OneAuth.** This is the main limit of browser-delivered E2EE. Native apps or a code-transparency mechanism are needed.
- **A stable recovery key that survives rotation without the user re-entering it.** It was evaluated and rejected (`key-rotation.md` §8).
- **Hiding metadata:** sizes (no padding), counts, timings, folder tree shape.
- **Real-device verification.** The `device-testing.md` checklist hasn't been run.

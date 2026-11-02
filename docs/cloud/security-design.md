# OneAuth Cloud: security design (v1, developer preview)

**Status:** implemented behind `ONEAUTH_CLOUD_PREVIEW=1` for **test files only**. Not reviewed by an independent cryptographer. Real personal data must not be stored until that review is done and the open items in §11 are closed. This document supersedes the implementation-specific parts of [`proposals/cloud-encryption.md`](../proposals/cloud-encryption.md), which remains the long-term direction (hardware-backed native keys, SAS-bound pairing, PRF recovery).

## 1. Goals

| Goal | How |
| --- | --- |
| The server never receives plaintext file contents, file names or folder names | All encryption happens in the browser (WebCrypto). The server stores ciphertext and wrapped keys only. |
| The server never receives an unwrapped vault key | The vault key exists in plaintext only in a client's memory, and is wrapped for each device or the recovery key before upload. |
| Losing one device doesn't lose the vault | Any approved device, or the recovery key, can unwrap the vault key. |
| Losing every device *and* the recovery key does lose the vault | By design. Stated to the user before setup and on the recovery screen. No staff override exists. |
| Revoking a device stops future access | The server stops serving that device's key envelope and file objects. It **cannot** erase keys or files already on that device (§8). |
| No home-made cryptography | AES-256-GCM, AES-KW (RFC 3394), HKDF-SHA256, ECDH P-256 via WebCrypto; JWE `ECDH-ES+A256KW` (RFC 7518) via `jose`. The only OneAuth-specific construction is the chunk framing in §4, which is standard AEAD usage and is listed for review. |

**Separation of concerns.** Passkeys **authenticate** the user to OneAuth's server. They don't encrypt anything and aren't used as encryption keys. The vault key is unlocked by a **device key** (or the recovery key), and files are encrypted with **file keys**. Recovery restores **vault access**; it doesn't restore sign-in. Sign-in recovery is a separate problem (see `proposals/account-recovery.md` when written).

## 2. Key hierarchy

```
Vault key  VK  (AES-256, random, one per user, generated on the first device)
 ├─ wrapped for each approved device:  JWE ECDH-ES+A256KW / A256GCM  →  vault_devices.envelope
 ├─ wrapped for the recovery key:      AES-KW(KRK, VK)               →  vaults.recovery_envelope
 ├─ Name key  NK = HKDF-SHA256(VK, salt = vaultId, info = "oneauth/v1/names")  (AES-256-GCM, folder names)
 └─ File keys FK (AES-256, random, one per file version)
      wrapped:  AES-KW(VK, FK)                       →  cloud_files.wrapped_key
      content:  chunked AES-256-GCM under FK (§4)    →  object storage
      metadata: AES-256-GCM under FK (name, type, plaintext size, mtime)  →  cloud_files.encrypted_meta
Recovery key RK (256 random bits, shown once to the user as 13 groups of 4 Base32 characters)
 ├─ KRK = HKDF-SHA256(RK, salt = vaultId, info = "oneauth/v1/recovery")  (AES-KW)
 └─ Recovery proof RP = HKDF-SHA256(RK, salt = vaultId, info = "oneauth/v1/recovery-proof"); server stores SHA-256(RP)
Device key DK (ECDH P-256, generated in the browser, private key non-extractable, kept in IndexedDB)
```

- **Why AES-KW for file keys:** deterministic, standard (RFC 3394) and native to WebCrypto. It only wraps uniformly random keys, which is its intended use.
- **Why JWE for device envelopes:** ECDH-ES with Concat KDF and AES-KW is a published, widely implemented standard. We use `jose` rather than assembling ECDH + KDF ourselves.
- **Why the recovery key needs no password-hardening KDF:** it has 256 bits of entropy and is never a human-chosen password.

## 3. Device enrolment and approval

1. On a new owned browser (signed in with a passkey), the user opens Cloud. The browser generates DK, stores the non-extractable private key in IndexedDB, and registers the public JWK. The server records `vault_devices(status = 'pending', fingerprint)`.
2. The fingerprint is the first 12 Base32 characters (60 bits) of `SHA-256(canonical public JWK)`, displayed as `XXXX-XXXX-XXXX`. The new device shows it. (v1 used 40 bits; Phase 2B raised it because grinding about 2⁴⁰ key pairs to match a code is within reach of rented compute. Existing 40-bit records stay valid.)
3. On an already-approved device, Cloud lists pending devices. The approver's browser **recomputes the fingerprint from the public key the server returned** and shows it. The user approves only if it matches the one on the new device's screen. This detects a server (or attacker) substituting its own public key.
4. Approval requires a passkey step-up (existing `reauth_at` window). The approving browser wraps VK to the new device's public key and uploads the envelope. The server checks that the approver is an `active` vault device of the **same user**, and stores it.
5. Alternatively, the new device enters the **recovery key**. It unwraps VK locally, wraps it to its own DK, and becomes `active`. To stop a pending device from activating itself without the key, it also sends the recovery proof RP; the server compares SHA-256(RP) with the verifier stored at vault creation (constant-time). RP is domain-separated from KRK, so the verifier reveals nothing usable to unwrap VK. This is logged as `cloud.recovery_used`.

Shared or temporary devices and paired sessions get **no** Cloud access in v1: the `cloud:*` scopes aren't grantable to them.

## 4. File format

```
header (16 bytes):  "OAC1" | version u8 = 1 | reserved u8[3] | chunkSize u32 BE | chunkCount u32 BE
chunk i:            nonce (12 bytes, random) | AES-256-GCM(FK, nonce, plaintext_i, AAD_i) (ciphertext ‖ 16-byte tag)
AAD_i = "oneauth/v1/chunk" | fileId (16 bytes) | header (all 16 bytes) | i u32 BE
```

- **Chunk size:** 1 MiB of plaintext. The last chunk may be shorter; an empty file has one empty chunk.
- **Order, truncation and splicing:** `i`, the complete header (including `chunkCount` and the reserved bytes, which must be zero) and `fileId` are authenticated in every chunk. Reordering, dropping, appending, moving chunks between files, or altering any header bit fails decryption. An earlier draft authenticated only `chunkCount`; the test suite caught that the reserved header bytes were malleable, and v1 authenticates the whole header.
- **Nonces:** 96-bit random per chunk under a key used for one file version only. Limits are far below 2³² messages per key, so the random-nonce collision bound is negligible.
- **Integrity:** GCM tags are authoritative and checked by the client. The server additionally verifies the declared ciphertext size and SHA-256 at upload completion, which detects transport and storage corruption but carries no authority over content.

## 5. Metadata protection

| Encrypted (server can't read) | Visible to the server |
| --- | --- |
| File names, MIME types, plaintext sizes, user-set modified times; folder names | Folder tree shape (opaque IDs and parent links); ciphertext sizes (≈ plaintext + 28 bytes per MiB + 16); upload, download and update times; counts; which device did what; favourite and trash flags |

Sorting by name happens on the client after decryption. Ciphertext size padding (Padmé) is **not** in v1 and is a review item.

## 6. Storage and quota

- A storage-driver interface (`lib/server/cloud/storage.ts`) with:
  - **`postgres`** (implemented, preview): ciphertext stored in 1 MiB rows, uploaded chunk-by-chunk through authenticated API requests (each well under Vercel's request-body limit).
  - **`s3`** (designed only): direct-to-bucket multipart upload with short-lived, single-object, size-bounded presigned URLs (Cloudflare R2). It isn't implemented because no object store is provisioned, and provisioning one is a paid-service decision.
- **Quota:** entitlements come from `lib/plans.ts` (`cloudBytes`). Starting an upload **reserves** the declared ciphertext size inside a transaction that locks the user's `storage_usage` row. It's rejected if `used + reserved + size > quota`, so concurrent uploads can't overshoot. Completion converts the reservation to usage **only if** the stored bytes equal the declared size and the hash matches. Cancelling or failing releases it, and purging releases usage. The client is untrusted throughout: declared sizes are capped, stored bytes are counted by the server, and over-declaration fails completion.
- Preview limits: 25 MiB per file; Free plan `cloudBytes` = 100 MiB in preview.

## 7. Authorisation

- New scopes `cloud:read` and `cloud:write`, granted to passkey (primary) sessions on owned devices only.
- Each Cloud tables row is `user_id`-scoped by RLS (`oneauth_app` role, migration `0004`), on top of application checks.
- File content and key envelopes are served only to a session whose device is an **active** vault device of the same user. A pending or revoked device gets nothing but its own pending record.

## 8. Revocation and deletion semantics

- **Revoking a vault device** deletes its envelope and marks it `revoked`; disconnecting the device in Devices also revokes it. The server then refuses that device. **Already-downloaded files and any VK copy held in that browser's memory can't be recalled.** **Vault-key rotation** (new VK; re-wrap every FK, folder name and Space item; re-issue envelopes and the recovery key) is specified in [`key-rotation.md`](key-rotation.md) and implemented as a staged protocol behind the preview flag. Rotation protects material added afterwards. It does not re-encrypt existing file contents (that's deep rotation, designed only).
- **Trash** is reversible. **Delete permanently** removes the ciphertext rows and wrapped key immediately and releases quota. Provider backups (Neon point-in-time history) may retain ciphertext until they expire. Without VK the ciphertext is unreadable, but "secure deletion" is limited to that guarantee.

## 9. Threat model

| Adversary | Outcome in v1 |
| --- | --- |
| Database or storage breach | Ciphertext, wrapped keys, metadata in §5. No plaintext, no VK. |
| Curious or compromised server operator | Same as above. **Can** substitute public keys during enrolment, but fingerprint comparison detects it if the user compares. **Can** serve modified JavaScript that exfiltrates keys. This is the main limit of browser-delivered E2EE: there's no code transparency yet. |
| Network attacker | TLS; plus AEAD on content. |
| Another OneAuth user | RLS + application checks; cross-user tests. |
| Malware or extension in an approved browser | Can read VK and plaintext while the vault is unlocked. Out of scope. |
| Stolen unlocked laptop with an active session | Same as malware until the device is revoked. The non-extractable DK can't be copied off the machine, but it can be used on it. |
| Phished pairing / relay | No Cloud access via pairing in v1 (§3). |
| User loses every device and the recovery key | Vault unrecoverable (by design). |
| XSS on oneauth origin | Equivalent to the malicious-JavaScript case. CSP with nonces and strict-dynamic reduces risk. |

**Malware scanning:** the server can't scan end-to-end-encrypted content. Any scanning would have to happen on the client, and isn't implemented.

## 10. Implementation map

- `lib/vault/crypto.ts`: all primitives above; isomorphic (browser and Node WebCrypto); unit-tested.
- `lib/vault/keystore.ts`: IndexedDB persistence of the non-extractable device key (browser only).
- `db/migrations/0004_cloud_foundation.sql`: tables, constraints, RLS.
- `lib/server/cloud/*`: vault, devices, files, folders, quota, storage driver.
- `app/api/cloud/*`, `app/(app)/cloud/*`: API and UI.

## 11. Review checklist (must be signed off before real data)

1. Chunk framing (§4): AAD contents; header handling; nonce strategy.
2. Fingerprint length (60 bits since Phase 2B) against an online key-substitution attacker.
3. IndexedDB key storage lifetime and clearing on sign-out or revocation.
4. The VK rotation design (`key-rotation.md` §8 lists its questions), and deep rotation.
5. Recovery-key UX: confirmation quiz; storage advice.
6. Padmé padding and metadata exposure.
7. Code-delivery trust: SRI, a build manifest, native apps for key-holding devices.
8. `s3` driver: presigned URL scoping and multipart integrity before enabling.
9. Abuse: free-tier storage farming; rate limits on upload sessions.

## 12. Phase 2B self-review (not an independent audit)

The implementation was reviewed against this design by the same team that wrote it. Each finding has a regression test in `tests/integration/cloud-adversarial.test.ts` or `tests/unit/vault-names.test.ts`.

| # | Finding | Fix |
| --- | --- | --- |
| F1 | Abandoned uploads held their quota reservation forever | Released after 24h under the usage lock; at most 20 unfinished uploads |
| F2 | Folder-move cycle check was check-then-act; concurrent moves could create a cycle. The same race let a file moved or uploaded into a folder being deleted cascade away without releasing quota | Per-account advisory lock on tree changes |
| F3 | Space pins returned wrapped keys and encrypted metadata to browsers without vault access, even with Cloud disabled | Locked count only |
| F4 | A pending browser could remove approved browsers | Needs vault access, except to withdraw itself |
| F5 | A leftover request from a disconnected device could be approved | The device must still be connected and owned |
| F6 | Download Blob type came from decrypted metadata; a browser that opens blob URLs could run HTML/SVG on the OneAuth origin | Always `application/octet-stream` |
| F7 | Decrypted names weren't sanitised (bidi overrides, controls) | `lib/vault/names.ts` |
| F8 | 40-bit security codes | 60 bits |
| F9 | No rate limits or row caps on Cloud writes | Added |
| F10 | No way to delete a browser's stored device key | "Remove this browser" |

**Reviewed and found consistent with the design:** a random 96-bit nonce per chunk and per sealed record under single-purpose keys; full-header and file-ID AAD; label plus 16-byte ID AAD in `sealJson` (unambiguous); non-extractable device keys; file keys extractable only inside `rewrapFileKey`; RLS on every table, including the new ones (`db-verify` in every build).

**Client trust assumptions (unchanged):** the browser runs whatever JavaScript the server sends. A malicious or compromised deployment can exfiltrate keys. This is the main reason Cloud stays preview-only.

**Sign-out:** signing out ends the session but deliberately keeps this browser's device key, so the same owned browser doesn't need re-approval. "Remove this browser" withdraws vault access and deletes the key. Whether sign-out on an owned device should offer this by default is a review item.

## 13. Phase 2C self-review (not an independent audit)

The full inventory of what is and isn't enforced is in [`guarantees.md`](guarantees.md).

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| R1 | Resuming an interrupted rotation trusted an anonymous envelope. A server with database write access could plant a rotation and have a browser re-wrap **every file key** under a key the server chose | **Critical** (preview only; no real data) | Transition proof under the outgoing key, verified before any re-wrapping |
| G1 | Browsers accepted whatever key version the server sent (rollback) | High | Version in the authenticated JWE header; per-browser pins (highest version, commitment per version) |
| G5 | Newly approved browsers couldn't tell whether their envelope came from the approver (key injection) | High | Two-screen confirmation code from the key actually received; read-only until confirmed |
| G2 | Rotation left existing contents under the old file keys | Medium | Deep rotation (rollback-safe swap) |
| G3 | Every rotation forced a new recovery key | UX/safety | Option to keep it by re-entering it, refused when a removed browser used it |
| G4 | Space kept a stale key after a rotation elsewhere | Low | Re-checked every sync tick |
| L1 | Lock order differed between moves, uploads into folders and the re-encryption swap (possible deadlocks) | Low | One order everywhere: tree, then usage, then rows |
| U1 | After re-encryption the file list kept the old IDs (downloads 404) | Low (UX) | Listing reloads when files are replaced |

An asymmetric "stable" recovery key was evaluated and rejected because its envelopes would be forgeable by the server (`key-rotation.md` §8).

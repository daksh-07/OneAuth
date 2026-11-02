# Vault-key rotation (design v1, developer preview)

**Status:**
- **Design:** written, **not independently reviewed**.
- **Implemented behind `ONEAUTH_CLOUD_PREVIEW=1`, for test data only:** the staged protocol below (start → re-wrap in batches → commit or abort), the write guards and the tests.
- **Not implemented:** content re-encryption ("deep rotation", §7) and automatic rotation.

## 1. What rotation does, and what it can't

When a browser is removed (or suspected compromised), the server immediately stops serving it anything: no envelopes, no file parts, no metadata (`security-design.md` §8). That's **future-access revocation by the server**, and it already exists.

Rotation adds a **cryptographic** cut-off for future material. It replaces the vault key VK₁ with a fresh VK₂ and re-wraps everything that VK protects. After rotation:

| | Protected from the removed browser? |
| --- | --- |
| Files uploaded **after** the rotation | **Yes.** Their file keys are wrapped only under VK₂, which the removed browser never receives. |
| Folder names and Space items written after rotation | **Yes.** They're encrypted under keys derived from VK₂. |
| Files that existed **before** the rotation | **Only against future server-side access.** Rotation re-wraps their file keys under VK₂ but doesn't change the file keys or the ciphertext. A removed browser that kept VK₁ and listed the vault before removal can derive those file keys. If it ever got the ciphertext (for example from a database breach), it could decrypt it. Only deep rotation (§7) closes this. |
| Anything already downloaded or decrypted on the removed browser | **No.** Nothing can recall data that has already left. |

The UI says this in plain language and never describes rotation as "making the device's copies unreadable".

## 2. Key and data model

| Item | Under VK₁ before rotation | During rotation | After commit |
| --- | --- | --- | --- |
| Device envelopes | `vault_devices.envelope` = JWE(VK₁) | `next_envelope` = JWE(VK₂) for **every active** browser | `envelope` = old `next_envelope` |
| Recovery | `vaults.recovery_envelope` / `recovery_verifier` (RK₁) | `vault_rotations.next_recovery_*` (**new** RK₂) | replaced by RK₂ |
| File keys | `cloud_files.wrapped_key` = AES-KW(VK₁, FK) | `next_wrapped_key` = AES-KW(VK₂, FK) | swapped; `key_version` = 2 |
| Folder names | `encrypted_name` under NK₁ = HKDF(VK₁) | `next_encrypted_name` under NK₂ | swapped; `key_version` = 2 |
| Space items | `encrypted_body` under SK₁ = HKDF(VK₁) | `next_encrypted_body` under SK₂ | swapped; `key_version` = 2 |
| `vaults.key_version` | 1 | 1 (the authoritative version doesn't change until commit) | 2 |

**Why a new recovery key every time.** The rotating browser doesn't know RK₁, so it can't wrap VK₂ under it. A design where any device can wrap to a *recovery public key* (an X25519 pair derived from RK) was considered and deferred to review. Issuing a fresh RK is also the right answer whenever RK₁ might be exposed: we know whether a removed browser was ever unlocked with the recovery key (`approved_via = 'recovery'`).

## 3. Protocol

1. **Prepare (client, local only).** Generate VK₂ and RK₂. Show RK₂ and require confirmation (same flow as setup). Nothing is sent yet.
2. **Start** `POST /api/cloud/vault/rotation`. Needs an active vault browser, a fresh passkey step-up and a rate limit. The body carries:
   - JWE(VK₂) for **exactly** the set of currently active browsers. The server checks set equality and returns `409 devices_changed` if a browser was added or removed in the meantime; the client re-reads and retries.
   - the RK₂ recovery envelope and proof.

   The server locks the vault row, refuses a second concurrent rotation (`409 rotation_in_progress`, plus a unique partial index), and stores the `next_*` values.
3. **Re-wrap** (repeated) `GET …/rotation/work` returns up to 200 files, folders and Space items that have no `next_*` value yet. The client:
   - unwraps or decrypts with VK₁ and re-wraps or re-encrypts with VK₂;
   - **verifies each result decrypts under VK₂**;
   - sends it with `POST …/rotation/batch`.

   Batches are idempotent and safe to repeat.
4. **Commit** `POST …/rotation/commit`. Under the vault-row lock, the server checks that nothing is missing: every file (including unfinished uploads), folder, Space item and active browser has its `next_*` value. If anything is missing it returns `409 rotation_incomplete` with counts, and the client goes back to step 3. Otherwise it swaps everything in **one transaction**, increments `key_version`, clears `next_*` and records `cloud.vault_rotated`.
5. **Abort** `DELETE …/rotation`. Clears every `next_*` value. VK₁ and RK₁ stay authoritative, and the UI tells the user that the RK₂ they saved won't work.

## 4. Failure handling

| Situation | Behaviour |
| --- | --- |
| **Interrupted rotation** (tab closed, crash, network) | Nothing authoritative changed. Any **active** browser can **resume**: it unwraps its own `next_envelope` to get VK₂, continues step 3 and commits. Any active browser can also abort. |
| **Concurrent devices** | During a rotation, writes that carry VK-protected material are refused with `409 rotation_in_progress`: new uploads, folder create/rename, Space item writes, approvals and recovery. Writes that don't involve VK still work: finishing parts of an upload already started, renaming a file (its metadata is under its file key), trash, favourites, delete. The guard takes a `FOR SHARE` lock on the vault row and start/commit take `FOR UPDATE`, so a write can't slip between commit's check and its swap. |
| **Stale clients** | Every VK-protected write carries the client's `keyVersion`. If it isn't the vault's current version, the server returns `409 stale_key`. Clients compare `vault.key_version` on each sync and re-unlock from their new envelope. |
| **Offline devices** | Active browsers that are offline still get `next_envelope` (it's encrypted to their public key, so they needn't be online). After commit they unlock VK₂ on their next visit. |
| **Removed during rotation** | Removing a browser clears its `next_envelope` too, so it never receives VK₂. |
| **Pending browsers** | They can't be approved during a rotation. After commit they're approved normally, with VK₂. |
| **Recovery failures** | Recovery is refused during a rotation. After commit only RK₂ works. If the user aborts, RK₁ remains valid. The UI states which key is current. |
| **Rollback safety** | Before commit, old values are untouched and authoritative, and every new value has been checked by the client. Commit is a single transaction (all or nothing). After commit there's no rollback: VK₁ material is deleted rather than kept, because keeping it would preserve exactly what rotation is meant to retire. |

## 5. Authorisation

Starting, committing and aborting need an **active** vault browser and an owned, primary passkey session. Starting also needs a fresh step-up. RLS confines every statement to the account. The work and batch endpoints accept only rows of the account's own vault; RLS enforces this and the tests check it.

## 6. Tests (`tests/integration/key-rotation.test.ts`)

- Full rotation across two active browsers (one offline during the rotation) and one removed browser. After commit:
  - the offline browser unlocks VK₂ and decrypts existing files;
  - VK₁ no longer unwraps any stored key;
  - RK₁ is refused and RK₂ works.
- Interruption and resumption from the *other* browser; abort restores VK₁ and RK₁.
- Writes refused during rotation; stale `keyVersion` refused after commit.
- `devices_changed`, `rotation_incomplete`, concurrent starts (exactly one wins), cross-account isolation, unfinished uploads included.

## 7. Deep rotation (designed only)

To protect **existing** files against a removed browser that kept VK₁ and file keys, each file must be re-encrypted under a new file key: download, decrypt, re-encrypt with a new FK and file ID, upload, then atomically replace. It costs the full vault size in bandwidth and is resumable per file. It needs the S3/R2 driver (direct-to-bucket) to be practical, and it's a review item.

## 8. Review questions

1. Is the "fresh RK on every rotation" policy acceptable, or should recovery move to an asymmetric (X25519) recovery key?
2. Is blocking VK-protected writes during rotation acceptable at real vault sizes, or is dual-version writing needed?
3. Should rotation be **required** (rather than recommended) after removing a browser that was unlocked with the recovery key?
4. Retention: confirm that VK₁ material must not be kept after commit.

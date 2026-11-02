# Vault-key rotation (design v2, developer preview)

**Status:**
- **Design:** written, **not independently reviewed**.
- **Implemented behind `ONEAUTH_CLOUD_PREVIEW=1`, for test data only:**
  - the staged protocol (§3);
  - client-side key trust (§3a, Phase 2C);
  - keeping the recovery key by re-entering it (§2);
  - deep rotation (§7, Phase 2C);
  - the tests in §6.
- **Not implemented:** automatic rotation, and an asymmetric recovery key (evaluated and rejected, §8).

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

**Recovery key during rotation (Phase 2C).** The rotating browser doesn't know RK₁, so there are two options:
- **Default: a new RK₂.** It's shown once and confirmed, exactly as at setup.
- **Keep RK₁.** The user re-enters it, and the browser seals VK₂ under it with the same authenticated AES-KW construction. The server accepts this only with a proof matching the stored verifier. It **refuses** (`recovery_replacement_required`) if any browser that was unlocked with the recovery key has been removed since that key was set (`vaults.recovery_set_at`), because that browser could have kept it.

A stable recovery key that needs no re-entry was evaluated and rejected (§8).

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

## 3a. Client-side trust in a new key (Phase 2C)

The server is untrusted. A server with database write access could otherwise:
- (a) replay an older envelope that a removed browser can also open (**rollback**);
- (b) put a different key under a version a browser already knows (**substitution**);
- (c) invent a "rotation", or a newly approved browser's envelope, carrying a key the server chose (**injection**). Device envelopes are anonymous ECDH-ES, so their contents aren't authenticated to an approver.

Before PR #2's Phase 2C, (c) applied to **resuming an interrupted rotation**. A browser that pressed "Finish it" would have re-wrapped every file key under a key the server chose. The defences are below; all are in `lib/vault/trust.ts`.

| Defence | Mechanism |
| --- | --- |
| Version binding | Device envelopes carry `oak_kv` in the JWE protected header, which the AEAD authenticates |
| Rollback and substitution | Each browser pins, in IndexedDB, the highest version it accepted and a commitment `SHA-256("oneauth/v1/vk-commit" ‖ vaultId ‖ v ‖ VK)` per version. A lower version, or a different key under a pinned version, is refused |
| Transition proof | The rotating browser stores `HMAC(HKDF(VK_old, "oneauth/v1/transition"), vaultId ‖ from ‖ to ‖ commit(VK_new))`. A browser that pinned `from` keeps that HMAC key (non-extractable) and verifies the step before trusting `VK_new`. A resuming browser verifies it with the current key before re-wrapping anything |
| Confirmation code | When a browser can't verify a key itself (first approval, or a multi-step jump), it shows `code = base32(SHA-256("oneauth/v1/vk-confirm" ‖ vaultId ‖ v ‖ SHA-256(VK) ‖ thumbprint(device key)))[60 bits]`. An approved browser shows the same code for it. Until the user confirms, the browser is **read-only** (no writes under that key) |

**Residual risks:**
- A removed browser that **colludes with the server** knows VK_old and can forge the transition proof for the step it knew.
- Clearing site data resets a browser's pins.
- The confirmation code helps only if the user compares it.

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

## 7. Deep rotation (implemented in Phase 2C; preview only)

Shallow rotation leaves file contents under their old file keys. Deep rotation re-encrypts each file:

1. The browser downloads and decrypts the file.
2. It re-encrypts it under a **new file key and a new file ID**.
3. It uploads it with `replacesFileId`.
4. On completion, after the server has checked size and SHA-256, **one transaction** swaps the new file in. Folder, favourite, trash state and Space pins carry over, the old ciphertext rows are deleted, and quota is settled.

**Rollback safety:**
- The original stays authoritative and listed until the swap.
- Interrupting at any point leaves it intact; the unfinished copy expires (24h) or is cancelled, releasing its reservation.
- The swap is refused if the original was deleted (`replace_target_gone`) or changed (`changed_during_reencrypt`) meanwhile.
- A unique index allows one re-encryption per file at a time.

`cloud_files.content_version` records the vault-key version when the contents were encrypted, and rotation never changes it. `content_version < key_version` identifies files still at risk, which the Cloud page offers to re-encrypt.

**Limits:**
- Each file briefly needs space for a second copy within the quota.
- Files whose stored ciphertext fails authentication can't be re-encrypted. They're reported and left in place.
- At real vault sizes this needs direct-to-bucket storage (S3/R2, not provisioned).
- Provider backups may keep old ciphertext until they expire.

## 8. Recovery-key design evaluation (Phase 2C)

**Option B, an asymmetric recovery key, was rejected.** It derives an X25519 key pair from RK and stores the public key, so any browser could wrap a new vault key to it without RK. X25519 works in the target browsers and in `jose`, but the scheme is unsafe here:
- ECDH-ES envelopes are anonymous. A server could write a recovery envelope holding a key it chose, and the recovering user (who has only RK) couldn't tell. Today's AES-KW envelope under an RK-derived key is authenticated.
- At rotation, the rotating browser must trust the stored public key. A server could substitute its own and receive the new vault key.
- Authenticating either one needs a key the server lacks. Any such key that's shared through the vault key is also held by removed browsers, which are exactly the attackers rotation is for.

**Chosen design:**
- A new RK by default.
- Or the user **re-enters** the current RK, which keeps it valid and stays authenticated. This is refused when a removed browser was unlocked with it.

## 9. Review questions

1. Is the recovery approach in §2 and §8 acceptable?
2. Is blocking VK-protected writes during rotation acceptable at real vault sizes, or is dual-version writing needed?
3. Should rotation be **required** (rather than recommended) after removing a browser that was unlocked with the recovery key?
4. Retention: confirm that VK₁ material must not be kept after commit.
5. §3a residual risks: is a confirmation code (user comparison) acceptable as the fallback for keys a browser can't verify itself?
6. Deep rotation: should re-encryption be prompted automatically after a removal, and how should files that fail authentication be handled?

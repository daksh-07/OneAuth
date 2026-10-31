# Proposal: OneAuth Cloud end-to-end encryption

**Status:** draft for review. **Do not implement production storage until this is reviewed** by an independent applied-cryptography reviewer and the open questions below are resolved.
**Scope:** client-side encryption, key hierarchy, device enrolment, multi-device access, recovery, transfer, metadata, economics, threat model.

## 1. Goals and non-goals

**Goals**
- G1. OneAuth's servers and staff can't read file contents, file names or folder structure.
- G2. A user can add devices and remove them without re-uploading everything.
- G3. A user who loses one device keeps access. A user who loses *every* device and recovery factor loses data. This is stated plainly; there's no back door.
- G4. Temporary (shared) devices get narrowly scoped, time-limited access to specific items, never the whole vault.
- G5. Built only from standard, reviewed primitives and libraries. No custom cryptography.

**Non-goals (v1)**
- Protecting data from a device that's already compromised while it's unlocked.
- Hiding *that* a user stores data, how much, or when (partly mitigated in §7).
- Server-side search, previews or thumbnails of plaintext.
- Collaborative real-time editing.

## 2. Primitives

| Purpose | Choice | Implementation | Why |
| --- | --- | --- | --- |
| File content AEAD (streaming) | XChaCha20-Poly1305 `secretstream` | libsodium (libsodium.js / native) | Designed for chunked streams; detects truncation and reordering via the final tag; widely reviewed |
| Key wrapping (symmetric) | XChaCha20-Poly1305 with 192-bit random nonce | libsodium `crypto_aead_xchacha20poly1305_ietf` | Random nonces are safe at this size |
| Public-key wrapping to a device | HPKE (RFC 9180), DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM | Platform WebCrypto / CryptoKit / Android Keystore primitives, assembled by a reviewed HPKE library | P-256 is the only curve with hardware support across Secure Enclave, Android StrongBox and WebCrypto non-extractable keys |
| Device signing | ECDSA P-256 | Same hardware-backed keys (separate key pair) | Signs enrolment records and envelopes |
| KDF | HKDF-SHA256 | WebCrypto | Standard |
| Recovery passphrase (optional) | Argon2id (m=256 MiB, t=3, p=1, tuned per platform) | libsodium `crypto_pwhash` | Memory-hard |
| Passkey-derived wrapping key | WebAuthn **PRF extension** output → HKDF | Browser or OS | Lets synced passkeys unlock the vault on new devices (§5.3) |

Open question Q1: whether to standardise on one library (e.g. libsodium everywhere plus a P-256 HPKE implementation), or use platform crypto per OS with cross-platform test vectors. Either way, every platform must pass a shared test-vector suite before release.

## 3. Key hierarchy

```
Account Root Key (ARK)  — 256-bit random, generated on the first Cloud-enabled device, never stored in plaintext on the server
 ├─ Account Identity Key pair (AIK, P-256) — private key wrapped by ARK; public key published for sharing
 ├─ Space Keys (SK_personal, SK_work, …) — 256-bit random, wrapped by ARK
 │    ├─ Metadata Key  MK = HKDF(SK, "oneauth/metadata/v1")
 │    └─ File Keys (FK) — 256-bit random per file version, wrapped by SK
 │          └─ file content: secretstream(FK), 4 MiB chunks
 └─ (wrapped copies of ARK)
      ├─ one HPKE envelope per enrolled **owned** device (to that device's hardware-backed P-256 key)
      ├─ one envelope per **passkey with PRF** support (§5.3)
      └─ one envelope under the **Recovery Key** (§5.2)
```

Server tables (new, planned): `device_keys(device_id, enc_pub, sig_pub, attestation, created_at, revoked_at)`, `key_envelopes(id, owner_kind, owner_id, wrapped_key, alg, created_at)`, `spaces(id, user_id, wrapped_sk, sk_version)`, `files(id, space_id, encrypted_metadata, wrapped_fk, ciphertext_size_padded, object_key, content_hash, created_at)`, `folders(…)` (encrypted names, opaque parent IDs).

## 4. Device enrolment (extends today's pairing)

1. The new device generates hardware-backed key pairs: an encryption key (ECDH P-256, non-extractable) and a signing key.
2. Its pairing request now includes `enc_pub` and `sig_pub`. **The 8-character confirmation code becomes a short authentication string derived from those keys**: `code = Base25(HKDF(SHA-256(enc_pub ‖ sig_pub ‖ request_nonce), "oneauth/sas/v1"))[0..8]`. The user's existing "pick the matching code" step then also proves that the keys the approver sees are the keys on the screen in front of them, so a malicious server can't substitute its own key undetected. (≈37 bits: an online attacker gets one guess per request, and a wrong pick cancels the request.)
3. The approving device (which holds ARK) recomputes the code from the keys the server relays. Only if the user picks that code does it HPKE-seal ARK to `enc_pub` and sign the envelope with its own device signing key.
4. The new device opens the envelope, verifies the signature chain against the account's device list, and caches nothing in plaintext at rest beyond the OS-protected key store.

Shared or temporary devices never receive ARK or space keys. The approver re-wraps only the selected **file keys** (or a dedicated, per-grant ephemeral folder key) to the temporary device's key, with the grant's expiry recorded server-side. The server refuses to serve those envelopes after expiry or revocation. **This can't claw back keys or plaintext the device already fetched**, and the UI must say so.

## 5. Recovery (no staff back door)

Users get several independent factors. Any one restores ARK on a new device:

### 5.1 Another enrolled owned device
The default. Pair the new device from an existing one (§4).

### 5.2 Recovery Key
A 256-bit random key shown once, as 24 words plus a QR code for printing. It's offered at Cloud activation, and the user must confirm they've saved it by re-entering 3 words. ARK is wrapped under it. The server stores only the envelope. Losing it and every other factor means the data is unrecoverable.

### 5.3 Passkey PRF
On devices whose passkey supports the WebAuthn PRF extension, a PRF output (salted per account) is used to derive a wrapping key for ARK. With synced passkeys (iCloud Keychain, Google Password Manager), a new phone signed in to the same platform account can unlock the vault with no other factor. Caveats:
- PRF support varies by platform and password manager; it's detected at runtime and never assumed.
- This ties vault access to the security of the user's platform account. Users are told so.
- PRF output must never leave the client.

### 5.4 Deferred: guardian (social) recovery
Threshold secret sharing of a recovery envelope among trusted contacts. Out of scope for v1; needs its own review.

**Explicitly rejected:** server-side escrow, support-driven resets that restore data, and deriving keys from the account password or email.

Account recovery for *sign-in* (getting back into the identity) is separate from *data* recovery. A user who restores sign-in through a future verified-email flow regains their account but **not** their encrypted data without one of the factors above. This must be visible in the UI before Cloud is enabled.

## 6. File transfer

- **Upload:** the client generates FK, encrypts in 4 MiB chunks with `secretstream`, and pads the final size (§7). It requests a short-lived (5-minute), single-object, size-bounded presigned `PUT` for Cloudflare R2, uploads with a SHA-256 checksum, and then commits the `files` row: encrypted metadata, wrapped FK, padded size, ciphertext hash. The server confirms the object exists and its size and hash match before accepting the commit, and counts quota on padded size.
- **Large files:** R2 multipart upload with per-part presigned URLs. Resumable, because chunk boundaries align with AEAD chunks.
- **Download:** a short-lived presigned `GET`. The client verifies the ciphertext hash and each chunk's AEAD tag; a missing final tag fails the download (no truncation).
- **Authorisation:** presigned URLs are issued only after the session's scopes and the device's grant are checked, and contain an unguessable object key unrelated to any IDs.
- **No plaintext ever touches OneAuth servers**, including thumbnails. Previews are rendered on the client.

## 7. Metadata privacy

| Encrypted (server can't read) | Visible to the server |
| --- | --- |
| File and folder names, MIME types, folder tree, file timestamps the user sets, tags | Number of objects; **padded** ciphertext sizes; upload and download times; IP addresses and devices used; space count; which device holds which grants |

- Size padding with **Padmé** (≤ 12% overhead) hides exact sizes.
- Folder hierarchy is an encrypted structure. The server sees opaque IDs, not parent/child names.
- Access-pattern hiding (e.g. ORAM) is out of scope; this is stated in the privacy policy.

## 8. Rotation and revocation

- **Revoking an owned device:** delete its envelopes immediately, so the server refuses further key fetches. Then a *lazy rotation* runs on the next owned device: generate new ARK′ and SK′, re-wrap all FKs under SK′ (keys only, no content re-encryption), and re-issue envelopes to remaining devices and factors. Content encrypted under FKs the revoked device could have cached stays readable by that device's copy. An optional **"re-encrypt everything"** action re-encrypts content with fresh FKs, costing time and bandwidth.
- **Temporary grants:** expiry or revocation removes envelopes; the same caveat applies.
- **Compromise of a recovery factor:** replace it, which rotates ARK.

## 9. Threat model

| Adversary | Can | Can't (by design) | Notes |
| --- | --- | --- | --- |
| Honest-but-curious server or insider | See metadata in §7; delete or withhold data | Read contents, names or keys | Integrity of withheld data → backups; availability is not E2E-protectable |
| **Malicious server** | Serve modified **web app code** that exfiltrates keys | Substitute device keys during pairing without the user's code check failing (§4) | **Largest residual risk of web E2EE.** Mitigations: native apps for key-holding devices, Subresource Integrity and a published build manifest, a future code-transparency log, and an optional browser extension that verifies bundle hashes. Until then, the web app is trusted like any web-delivered crypto. |
| Network attacker | Nothing beyond TLS metadata | Read or modify data | TLS plus AEAD |
| Thief with a locked owned device | Little | Extract non-extractable keys | Depends on OS protections |
| Malware on an unlocked owned device | Everything that device can decrypt | — | Out of scope; revocation limits future access |
| Compromised borrowed (shared) device | The specific items granted, while the grant is live, and anything already decrypted | ARK, space keys, other files | Grants should be short and per-item |
| Phished user (relay pairing) | If the user approves an attacker's device as *owned*, the attacker gets ARK | — | **Owned-device approval for Cloud should additionally require that the new device shows the *same* SAS code** (§4) and **default to "shared"**; proximity proof (native) remains the long-term fix |
| User who loses every factor | — | Recover data | By design. Communicated before activation. |

## 10. Storage economics (estimate; validate before pricing)

Assumptions: Cloudflare R2 list pricing as last checked (verify before any decision): about US$0.015 per GB-month storage, no egress fees, about US$4.50 per million Class A (write) and US$0.36 per million Class B (read) operations. A$1 ≈ US$0.65.

| Plan (proposed) | Price | Quota | Storage cost if 100% used | At a plausible 30% average use |
| --- | --- | --- | --- | --- |
| Personal Pro | A$8.99/mo (≈ US$5.85) | 100 GB | US$1.50 | US$0.45 |
| +100 GB add-on | A$3.99/mo (≈ US$2.60) | 100 GB | US$1.50 | US$0.45 |

Also budget for padding overhead (≤ 12%), multipart and versioning overhead, operations (≈ US$0.05–0.30 per active user per month at 4 MiB chunks), Postgres and compute, payment fees (≈ 1.7% + A$0.30 domestic card), GST, support and backups. Storage alone leaves a healthy margin at proposed prices. **Unknowns:** real utilisation, churn, abuse (free-tier storage farming). The free plan should start at **0–2 GB**, not more, until abuse controls exist. All prices are hypotheses in `lib/plans.ts`, not commitments.

## 11. Implementation plan (after review)

1. Shared crypto package with test vectors (JS, Swift, Kotlin), property tests and fuzzing of parsers. No product code.
2. Device key generation plus SAS-derived pairing codes (§4). Ships value even before Cloud.
3. ARK creation, recovery key and PRF factor UX, behind a feature flag, with no files yet.
4. Encrypted metadata, upload and download with R2, quota accounting.
5. Temporary per-item grants.
6. Rotation and re-encryption tools.
7. External review again before general availability.

## 12. Open questions for reviewers

- Q1. Library strategy (see §2).
- Q2. Is a ≈37-bit SAS enough given one online guess per request, or should owned-device enrolment use a longer (e.g. 6-word) comparison?
- Q3. PRF salt design and behaviour across iCloud Keychain, Google Password Manager and third-party passkey providers.
- Q4. Lazy versus eager rotation defaults after revocation.
- Q5. Whether to allow Cloud on web-only accounts before native apps exist, given the code-delivery risk (§9).
- Q6. Metadata: is Padmé plus encrypted tree enough for the target audience, or should file counts be bucketed too?

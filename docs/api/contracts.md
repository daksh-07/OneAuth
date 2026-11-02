# OneAuth HTTP API: current contract

**Status:** describes the routes that exist on `claude/oneauth-cloud-foundation`. This is the **first-party** API used by OneAuth's own web client. It is **not** a public or third-party API yet: there's no OAuth/OIDC provider, no API keys and no versioning guarantee. Breaking changes are allowed until v1 is declared (see "Versioning" below).

## Conventions

| Topic | Rule |
| --- | --- |
| Transport | HTTPS only in hosted environments. JSON bodies (`content-type: application/json`) except Cloud part uploads and downloads (`application/octet-stream`). |
| Authentication | `__Host-oa_session` cookie (`oa_session` in local development; HttpOnly, Secure in production, SameSite=Lax), holding an opaque token. The server stores only its SHA-256. There are no bearer tokens yet (see "Native clients"). |
| CSRF / origin | Every state-changing request must carry an `Origin` header from `ONEAUTH_ORIGINS`, or it gets `403 origin_not_allowed`. Private `GET` routes reject `Sec-Fetch-Site` values other than `same-origin`/`none`, and never send CORS headers. |
| Authorisation | Every handler checks the session's **scopes** (see `lib/scopes.ts`) and, for Cloud and Space, that the session is a **primary passkey session on an owned device**. Row-level security then confines every query to the session's user. |
| Step-up | Sensitive actions return `403 reauth_required` unless the session completed a passkey assertion in the last 5 minutes. Run `POST /api/auth/stepup/options` + `/verify`, then retry once. |
| Errors | `{ "error": "<code>", "message": "<plain-language text safe to show>" }` with a matching HTTP status. Codes are stable identifiers; messages may change. |
| Rate limits | `429 rate_limited` with `retry-after` seconds. Counters are per IP and per account, and persist even when the request fails. |
| Caching | All authenticated responses are `cache-control: no-store`. |
| IDs | UUIDs. Cloud file and folder IDs are **chosen by the client**, because they're bound into the encryption (AAD). |

## Authentication and devices

| Method & path | Scope | Purpose |
| --- | --- | --- |
| `POST /api/auth/register/options` → `/verify` | none | Create an account with a passkey (UV required). The verify body includes `device: { deviceKey, kind: 'owned' \| 'shared' }`. |
| `POST /api/auth/login/options` → `/verify` | none | Discoverable-credential sign-in. |
| `POST /api/auth/stepup/options` → `/verify` | session | Fresh passkey check; optionally bound to a `pairingRequestId`. |
| `POST /api/auth/passkeys/options` → `/verify` | `security:manage` + step-up | Add another passkey. |
| `POST /api/auth/signout` | session | End this session; shared devices also forget the device cookie. |
| `POST /api/pairing/request` | none (rate-limited) | New device asks to join; returns `{id, code, expiresAt, approveUrl}` and sets the requester's pairing-secret cookie. |
| `POST /api/pairing/status` / `claim` | pairing secret cookie | Poll for, and claim, an approved request. |
| `POST /api/pairing/approve` / `reject` | `devices:manage` + step-up bound to the request | Approve with the confirmed code, kind, scopes and duration. Remote-network requests need the typed code, and get limited scopes and duration. |
| `GET /api/account/export` | `security:manage` | JSON export of the account's data. |
| `GET /api/health` | none | `{status, database, schema, runtime_role, origins}`; 503 when degraded. |

## Cloud (developer preview: `ONEAUTH_CLOUD_PREVIEW=1`, never on Vercel production)

Design: [`docs/cloud/security-design.md`](../cloud/security-design.md). All bodies hold **ciphertext, wrapped keys or public keys only**.

| Method & path | Scope / extra | Request → response |
| --- | --- | --- |
| `GET /api/cloud/vault` | `cloud:read` | → `{vault, device, devices, usage}`. `device.envelope` (JWE) is returned only to an **active** vault device. Pending requests are listed only to active devices. |
| `POST /api/cloud/vault` | `cloud:write` + step-up | `{vaultId, recoveryEnvelope, recoveryProof, publicJwk, envelope}` → `{vaultId, fingerprint}`. `409 vault_exists`. |
| `POST /api/cloud/vault/devices` | `cloud:read` | `{publicJwk}` → `{id, status: 'pending', fingerprint}`. Idempotent for the same key. |
| `POST /api/cloud/vault/devices/:id` | `cloud:write` + step-up, active device | `{envelope, fingerprint}` → approve. `409 fingerprint_mismatch` / `not_pending`. |
| `DELETE /api/cloud/vault/devices/:id` | `cloud:write` + step-up | Remove a browser's vault access, or decline a request. |
| `GET /api/cloud/vault/recovery` | `cloud:read` | → `{vault_id, recovery_envelope}` (AES-KW ciphertext of the vault key). |
| `POST /api/cloud/vault/recovery` | `cloud:write` + step-up, pending device | `{envelope, recoveryProof}`. `403 recovery_mismatch`. |
| `GET /api/cloud/items?view=folder\|recent\|favorites\|trash&folder=` | `cloud:read`, active device | → `{folders, files, path}` (encrypted names and metadata). |
| `POST /api/cloud/files` | `cloud:write`, active device | `{fileId, folderId, size, sha256, encryptedMeta, wrappedKey}` → `{fileId, partSize, partCount}`. Reserves quota. `413 too_large` / `quota_exceeded`. |
| `PUT /api/cloud/files/:id/parts/:idx` | `cloud:write` | Raw bytes. Each part is exactly `partSize`, except the last. → `{stored}`. |
| `POST /api/cloud/files/:id/complete` | `cloud:write` | Server checks byte count and SHA-256, then settles quota. `409 integrity_mismatch`. |
| `GET /api/cloud/files/:id/parts/:idx` | `cloud:read`, active device | → raw ciphertext bytes. |
| `PATCH /api/cloud/files/:id` | `cloud:write` | `{encryptedMeta?, folderId?, favorite?, trashed?}`. |
| `DELETE /api/cloud/files/:id` | `cloud:write` | Cancel an unfinished upload or delete permanently, releasing quota. |
| `POST /api/cloud/folders` | `cloud:write` | `{id, parentId, encryptedName}`. |
| `PATCH /api/cloud/folders/:id` | `cloud:write` | `{encryptedName?, parentId?, trashed?}`. `409 invalid_move` on cycles. |
| `DELETE /api/cloud/folders/:id` | `cloud:write` | Empty folders only (`409 not_empty`). |

## Space

| Method & path | Scope | Purpose |
| --- | --- | --- |
| `GET /api/space` | `space:read` | → `{spaces, selectedId, devices}`. Only spaces visible to **this device**. Creates "Personal" on first use. |
| `POST /api/space` | `space:write` | `{name, kind}` → `{id}`. Maximum 12 spaces. |
| `POST /api/space/select` | `space:read` | `{spaceId}`. Remembered per device. |
| `PATCH /api/space/:id` | `space:write` | `{name?, kind?, accent?, allDevices?, deviceIds?}`. |
| `DELETE /api/space/:id` | `space:write` | Not the last one (`409 last_space`). Removes pins, not files. |
| `GET /api/space/:id/pins` | `space:read` | → `{files, folders}` with the encrypted fields needed to show and open them. |
| `POST /api/space/:id/pins` | `space:write` | `{fileId}` or `{folderId}`. Maximum 50 per space. |
| `DELETE /api/space/:id/pins/:pinId` | `space:write` | Unpin. |

## Versioning

Before any external client depends on this API:

1. Move the routes under `/api/v1/`, keeping the unversioned paths as aliases for the web client during migration.
2. Publish an OpenAPI 3.1 description generated from Zod schemas (Zod is already a dependency), and add a contract test that fails on undocumented changes.
3. Additive changes only within v1. Breaking changes need a new version, with at least 6 months of overlap.

## Native clients (designed, not implemented)

See [`docs/native/architecture.md`](../native/architecture.md). Native apps will **not** reuse browser cookies. They'll need:

- a token endpoint that issues short-lived access tokens bound to a device key (DPoP-style proof of possession, RFC 9449), plus a rotating refresh token stored in the Keychain or Keystore;
- the same scopes and RLS enforcement as the web;
- `Origin` checks replaced by proof-of-possession signatures for those tokens only.

None of these exist yet, and no route accepts bearer tokens today.

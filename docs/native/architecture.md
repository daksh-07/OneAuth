# OneAuth native apps: architecture (designed only)

**Status:** design. **No native code exists yet**, and nothing here has been built or tested on real hardware. Claims about Secure Enclave, StrongBox or biometrics describe the intended use of platform APIs, not verified behaviour.

## Why native

The browser is the right place to start, but three things need native apps:

1. **Key protection.** In the browser, the Cloud device key is non-extractable but held in software (IndexedDB). Native apps can keep it in the Secure Enclave (iOS) or in hardware-backed Keystore / StrongBox (Android), with biometric gating per use.
2. **Code-delivery trust.** Browser-delivered E2EE trusts the JavaScript served on each visit (security design §9). App-store binaries, with reproducible-build checks, narrow that.
3. **Approvals.** Push notifications to approve a pairing or vault request, an in-app QR scanner, and proximity-bound pairing (BLE / UWB) to resist relay. Proximity reduces relay risk; it doesn't *prevent* a relay with nearby equipment.

## Proposed stack

| Layer | Choice | Reason |
| --- | --- | --- |
| UI | SwiftUI (iOS), Jetpack Compose (Android) | Platform-native accessibility and passkey UI. Security-critical flows stay out of a cross-platform layer. |
| Shared logic | A Rust core (`oneauth-core`) via UniFFI | One audited implementation of the OAC1 file format, envelope handling and API client, shared with a WASM build for the web later. |
| Crypto | Platform keys for device keys; RustCrypto (`aes-gcm`, `aes-kw`, `hkdf`) for content; `josekit` or an equivalent JWE implementation, verified against `lib/vault/crypto.ts` test vectors | Same formats as the web client, so files move freely between them. |
| Passkeys | `ASAuthorizationPlatformPublicKeyCredentialProvider` / Credential Manager | Same relying party (`oneauth` domain) via associated domains / Digital Asset Links. |

## Authentication for native clients

1. Sign in with a passkey (same WebAuthn server; the native app's origin is declared via associated domains).
2. The app generates a **device-bound P-256 key** in the Secure Enclave or Keystore (non-exportable).
3. `POST /api/v1/token` (to be built) exchanges the WebAuthn result for:
   - an access token (10 minutes), **sender-constrained** with DPoP (RFC 9449) to the device key;
   - a refresh token (rotating, reuse-detection revokes the family), stored in the Keychain or Keystore.
4. Every API call carries `Authorization: DPoP <token>` and a fresh `DPoP` proof. The server keeps checking scopes and RLS exactly as for the web.
5. Revoking the device in OneAuth revokes its token family and, for Cloud, its vault-device record.

## Cloud on native

- **Device key:** an ECDH P-256 key in the Secure Enclave or StrongBox, registered via `POST /api/cloud/vault/devices` with the same fingerprint scheme. Approval works the same way (an existing device compares the code).
- **Vault key handling:** unwrapped into memory only after a biometric prompt (`LAContext` / `BiometricPrompt` with `CryptoObject`), and cleared when the app is backgrounded beyond a timeout.
- **Uploads:** background `URLSession` / WorkManager uploads of 1 MiB parts (the same `PUT …/parts/:idx` contract), resumable by part index.
- **Large files:** once the `s3` driver exists, native clients upload directly to presigned part URLs.

## Testing commitments

- Unit tests run against the shared test vectors (OAC1 tamper cases, JWE envelopes, recovery keys).
- **Real-device testing is required** before any claim about Secure Enclave, StrongBox or biometric behaviour. Simulators and emulators don't exercise the hardware paths, and results from them will be labelled as such.

## Not in scope for native v1

Password or session import from other apps, autofill of third-party credentials, and any form of "restoring" third-party accounts. OneAuth will only integrate where a service offers a supported, user-consented mechanism (for example passkeys or OAuth).

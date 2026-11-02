# User journeys

Implemented journeys are marked ✅. Planned ones are marked ◻︎.

## ✅ A: First-time onboarding
1. Landing → **Get started**.
2. `/signup`: enter a name, optionally tick "shared or public computer", then **Create passkey** (the OS prompts for Face ID, fingerprint or PIN).
3. `/welcome`, step 1: choose a primary use (stored in `user_profiles.primary_use`).
4. `/welcome`, step 2: explains passkey sync honestly, warns that recovery doesn't exist yet, offers **Add a backup passkey**.
5. `/home`: shows a single clear next action, plus a warning while only one passkey exists.

## ✅ B: Connecting a new laptop (owned)
1. Laptop opens `/connect`: QR, an 8-character code, and a 5-minute countdown.
2. Phone scans the QR → `/pair/<id>`, signing in first if needed.
3. Phone shows the reported device name, the same-network signal, and the warning to approve only a device you can see.
4. User picks the matching code from three. A wrong pick cancels the request on both screens.
5. User chooses **My own device**, scopes (it can manage devices but never passkeys), and 7 or 30 days.
6. **Approve with passkey** → step-up WebAuthn → server approves.
7. Laptop's poll sees `approved` → one-time claim → session cookie → `/home`.
8. Device appears under **Devices → Your devices**.

## ✅ C: Temporary device
Same as B, choosing **Shared or temporary**: defaults to name only, 15 minutes to 24 hours. The device shows a persistent "Temporary access … ends in" banner and has no route to account management.

## ✅ C2: Manual code entry
Phone: **Devices → Connect a device** → type the code → same approval screen with the code pre-confirmed.

## ✅ D: Disconnecting
**Devices → device → Disconnect**. The dialog explains that sessions end immediately, the device must be re-approved, and downloaded content can't be removed. Sessions and grants are revoked server-side in one transaction.

## ✅ Account management
Profile name, passkeys (add, rename, remove), active sessions (end any other session), theme, security history, export, sign out, delete account.

## ◻︎ E: Cloud file access
Blocked on the encryption and recovery design (see [roadmap](roadmap.md)). `/cloud` explains the status and shows the real plan entitlement (none).

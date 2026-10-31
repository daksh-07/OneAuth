# Known limitations and dependencies

## Not implemented (and labelled as such in the product)
- **OneAuth Cloud**: no file storage, upload, download or quotas. Blocked on the key-management and recovery design and its review.
- **OneAuth Space**: depends on Cloud.
- **Account recovery**: losing every passkey means losing the account. The UI pushes users to add a second passkey.
- **Email**: none collected, so no verification and no notifications.
- **Billing**: plans are configuration only, with no payment provider and no charges possible.
- **Native apps, push approvals, in-app QR scanner**: the phone uses its camera app and a browser.
- **Third-party service sign-in, hospitality and TV integrations**: require supported APIs and partnerships that don't exist yet.

## Honest limits of what is built
- Revoking a device ends its OneAuth sessions immediately. It can't erase anything already displayed, downloaded or captured.
- Temporary access doesn't protect against malware, screen capture or keyloggers on the borrowed device.
- Code matching defeats "blind approval" phishing but not an attacker who relays the code in real time.
- The device name and platform come from the user agent and can be spoofed.
- "Same network" is a heuristic (same IPv4, or same IPv6 /64), not a security control.
- Passkey availability across devices depends on the user's platform (iCloud Keychain, Google Password Manager, etc.).

## Infrastructure dependencies (blocking for a live preview)
- **PostgreSQL**: none is provisioned. The Vercel project has no `DATABASE_URL`, so deployments render public pages and an honest "not available on this deployment" state for sign-up, sign-in and pairing.
- **Vercel deployment protection**: SSO protection is on for preview URLs. Testers need Vercel team access, or a protection bypass must be configured.
- **WebAuthn RP ID**: passkeys are bound to the hostname. Passkeys created on a preview URL won't work on the production domain. Choose the long-term domain before inviting real users.

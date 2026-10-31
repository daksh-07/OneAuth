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

## Infrastructure dependencies
- **Preview database:** not provisioned yet. Supabase refused a third free project for this account, and Neon needs a one-click Marketplace install by the account owner. See [deployment](deployment.md#what-you-need-to-do-one-of-these). Until then, the preview shows "not available on this deployment" for sign-up, sign-in and pairing.
- **Production database:** deliberately not created.
- **Vercel deployment protection:** SSO protects previews. Testers need team access; automated hosted tests need a Protection Bypass for Automation secret.
- **WebAuthn RP ID:** passkeys are bound to the hostname. The preview uses the branch alias; passkeys made there won't work on the production domain. Choose the long-term domain before inviting real users.
- **Physical devices:** not yet tested on real phones and computers. See [device testing](device-testing.md).

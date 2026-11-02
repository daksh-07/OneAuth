# Competitive landscape (initial, qualitative)

Based on publicly known product capabilities. Not yet validated with market research or user interviews. No superiority claims should be made from this.

| Product | Already solves | Doesn't solve (relevant to us) |
| --- | --- | --- |
| Apple iCloud + passkeys | Seamless passkey sync and continuity within Apple devices | Cross-ecosystem device grants; time-boxed access for borrowed non-Apple devices |
| Google Password Manager / account | Passkey sync on Android and Chrome; QR-based hybrid sign-in to Google | Per-device scoped grants for a user's own data outside Google |
| Microsoft account / Windows Backup | Windows setup restore, OneDrive | Mixed-ecosystem, user-controlled temporary access |
| 1Password, Bitwarden | Cross-platform credential vaults, passkey storage, sharing | A device-grant model where the phone approves what a new device may access, and for how long |
| Proton Pass / Drive | End-to-end encrypted passwords and files, privacy brand | Device-continuity workflow and temporary-access UX |
| Dropbox | Mature file sync and sharing | Identity and device authority; client-side encryption by default |
| Hospitality casting providers | In-room casting and guest sign-in on hotel TVs | A portable personal identity spanning home, work and travel (also: they're potential partners) |

## Where OneAuth can credibly start
A single, cross-platform, understandable **device-access control centre**: approve, scope, time-box and revoke devices from your phone, with an honest security model. Cloud and workspace build on that authority.

## Threats
- Platform owners can ship similar cross-device approval inside their ecosystems.
- Password managers are adding device and access features.
- Without encrypted storage and integrations, the standalone value of device grants for consumers is unproven. **This needs validation interviews before Phase 3 investment.**

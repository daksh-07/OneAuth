# Founder-only release evidence

No physical-device or external-review result has been recorded. Use **disposable accounts and test files** on the protected Preview. For each run, record date, device model, OS/browser version, pass/fail, short screen recording or redacted screenshot, and any console/network error without secrets or recovery keys.

## Physical-device checks

1. iPhone Safari: create and sign in with a passkey after closing the tab. Confirm the real Face ID sheet, then sign out and verify the next request is unauthenticated.
2. Android Chrome: repeat with the actual fingerprint/screen-lock flow and Google Password Manager.
3. macOS Safari/Chrome and Windows Edge/Chrome: sign in with synced/hybrid passkeys; record the OS prompt and origin shown.
4. Laptop and phone: scan the QR with the Camera app, compare the requesting code on both screens, approve with passkey, then revoke; verify the laptop loses access. Repeat on mobile data and with temporary expiry.
5. Cloud C1–C12 in `docs/device-testing.md`: pay particular attention to iOS IndexedDB after a day, private browsing, harmless HTML/SVG download handling, two-screen confirmation codes, offline/resumed rotation, site-data clearing and VoiceOver/TalkBack. Never use personal files.

## Owner controls and approvals

- Coordinate the temporary Vercel automation-bypass rotation with an update to the GitHub Actions secret. Verify the old value fails and the manual hosted workflow passes before removing the old route. Do not share either value in chat.
- Arrange an independent cryptography and application-security review using `independent-review-package.md`. Approve scope and any fee before contact or purchase; request a pinned-commit retest.
- Keep Production Cloud off and do not merge PR #1 or #2 until the separate production authentication gate, physical tests and external review close. Decide separately whether to buy an object store after its design is reviewed.

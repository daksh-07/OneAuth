# MVP definition

The MVP proves one workflow end-to-end better than existing tools: **safely giving a new or borrowed device exactly the access you choose, from your phone, and taking it back.**

## In scope (this slice: built)

- Passkey sign-up and sign-in (WebAuthn, user verification required, discoverable credentials).
- Shared-computer sign-in mode: 8-hour session with read-only basic scopes.
- Authentication-aware app: Home, My Space, Devices, Cloud, Account & Security.
- Device pairing: QR plus short code, three-way code matching, passkey step-up, owned or temporary, scope and duration selection, one-time claim.
- Server-enforced scopes on every page, action and API route.
- Device and session revocation that takes effect on the next request.
- Passkey management: add (step-up), rename, remove (step-up, never the last one).
- Security history, JSON data export, account deletion (step-up plus typed confirmation).
- Light and dark themes, responsive layouts, reduced-motion support.

## Out of scope for the MVP (explicitly labelled in the UI)

- File storage, workspace sync, external providers, hospitality integrations.
- Account recovery beyond "add a second passkey".
- Email (collection, verification, notifications).
- Billing.
- Native apps.

## Acceptance criteria for this slice

- Every item above is covered by an automated test (see [checklist](checklist.md)).
- No UI element claims a capability that doesn't work.
- `typecheck`, `lint`, `test`, `build` and `test:e2e` all pass.

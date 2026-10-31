# Implementation checklist

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, partial or manual coverage · ◻︎ not started

## Identity
- ✅ Passkey registration with UV required (`auth.test.ts`, e2e)
- ✅ Passkey sign-in, discoverable (`auth.test.ts`, e2e)
- ✅ Challenge single use, expiry, origin binding (`auth.test.ts`)
- ✅ Counter regression rejected and logged (`auth.test.ts`)
- ✅ Shared-computer sign-in, narrow scopes, 8h (`auth.test.ts`)
- ✅ Session expiry, idle, revocation, locked account (`auth.test.ts`)
- ✅ Step-up bound to session and user (`auth.test.ts`)
- ✅ Add, rename and remove passkeys; never the last (`auth.test.ts`)
- ✅ Sign out (e2e)
- ✅ Account deletion with cascade (`auth.test.ts`)
- 🟡 Data export (route implemented; scope denial covered in e2e)
- ◻︎ Email verification and recovery pathways
- ◻︎ Security alerts (email or push)

## Connect
- ✅ Pairing request, code, expiry (`pairing.test.ts`)
- ✅ Three-way code matching, mismatch cancels (`pairing.test.ts`, e2e)
- ✅ Typed-code path (`pairing.test.ts`, e2e)
- ✅ Scope and duration validation; non-delegable scopes (`pairing.test.ts`)
- ✅ No approval from paired or shared sessions (`pairing.test.ts`)
- ✅ One-time claim, concurrency (`pairing.test.ts`)
- ✅ Device revocation kills sessions; BOLA (`pairing.test.ts`, e2e)
- ✅ Approval bound to a single-use, request-specific passkey confirmation (`pairing.test.ts`, mutation-checked)
- ✅ Presence confirmation when networks differ; joined-account display with back-out (e2e)
- ✅ Temporary session UI banner and server-side denial (e2e)
- ◻︎ Proximity-bound pairing (native)
- ◻︎ Push-based approval (native)

## Web security
- ✅ Nonce CSP present (e2e; verified on Vercel)
- ✅ Explicit origin allow-list, wildcard rejection, canonical redirect (unit, e2e; redirect verified on Vercel)
- ✅ Previous session revoked when a browser signs in again
- ✅ RLS enabled and API roles revoked (`database.test.ts`)
- ✅ TLS verification enforced for remote databases (unit)
- ✅ Cross-origin POST rejected (e2e)
- ✅ Open-redirect guard (unit)
- ✅ Rate limiting (`auth.test.ts`)
- ✅ Token hashing at rest (`auth.test.ts`)

## UX and accessibility
- ✅ axe WCAG 2.1 AA (serious and critical) on landing, home, account, approval, devices, manual connect (e2e)
- ✅ Contrast of all token pairs, both themes (unit)
- ✅ Screenshots at 390, 820 and 1440px, light and dark (e2e `visual.spec.ts`, reviewed manually)
- ✅ No console errors on core journeys (e2e)
- ✅ 24px minimum touch targets and no horizontal overflow on public and app screens (e2e)
- 🟡 Keyboard navigation: native controls, Radix focus traps, skip link; no automated tab-order test yet
- 🟡 Reduced motion: CSS rule present; not asserted by a test
- 🟡 Safari and Firefox engines: Playwright WebKit and Firefox run rendering, a11y, targets and pairing-screen checks; passkey ceremonies are Chromium-only
- ◻︎ Real-device testing (iPhone, Android)
- ◻︎ Screen-reader pass (VoiceOver, TalkBack)
- ◻︎ Slow-network and offline scenarios

## Platform
- ✅ Migrations runner
- ✅ Health endpoint
- ◻︎ Preview database provisioned (blocked: see limitations)
- ◻︎ Production database (deliberately not yet)
- ◻︎ Error monitoring
- ✅ CI workflow (typecheck, lint, unit and integration, build, e2e)
- 🟡 Hosted preview suite (`playwright.hosted.config.ts`; passes locally against a production build; blocked on the preview database)

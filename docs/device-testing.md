# Device and browser testing

## What is automated

| Suite | Engines and devices | Covers | Doesn't cover |
| --- | --- | --- | --- |
| `npm test` | Node + Postgres | WebAuthn verification (software ES256 authenticator), sessions, pairing, authorisation, RLS | Browser behaviour |
| `npm run test:e2e`, `desktop-chromium` | Chromium + **virtual WebAuthn authenticator** | Real passkey registration, sign-in and step-up; two-browser pairing; revocation; a11y; screenshots at 390, 820 and 1440px in light and dark; touch targets; overflow | Real biometrics, real OS passkey UI |
| `npm run test:e2e`, `iphone-webkit`, `android-chromium`, `desktop-firefox`, `desktop-webkit` | Playwright WebKit and Firefox, mobile emulation | Rendering, console errors, overflow, 24px targets, a11y, the QR pairing screen, the passkey-unsupported fallback | Passkey ceremonies (no virtual authenticator outside Chromium; Playwright's Linux WebKit has no WebAuthn) |
| `playwright.hosted.config.ts` | Chromium against the **deployed preview** | Real hosting, cookies, database and edge; the full scenario with cleanup | Same as desktop-chromium |

Emulation isn't real Safari, real Android Chrome, Face ID or a phone camera.

## Physical tests still required

Run on the hosted preview once it has a database. Record each result as pass or fail with the OS and browser version.

| # | Device | Test | What to check |
| --- | --- | --- | --- |
| 1 | iPhone, Safari (iOS 17+) | Sign up | Face ID prompt appears; passkey saved to iCloud Keychain; lands on Welcome |
| 2 | iPhone, Safari | Sign in after closing the tab | Passkey sheet offers the OneAuth passkey; Face ID; Home loads |
| 3 | Android, Chrome (14+) | Sign up and sign in | Fingerprint or screen-lock prompt; passkey saved to Google Password Manager |
| 4 | macOS, Safari and Chrome | Sign in with a synced passkey | Touch ID, or "use a phone" (hybrid/caBLE) with the iPhone |
| 5 | Windows 11, Edge and Chrome | Sign in with the phone's passkey | "Use a phone or tablet" → QR → phone approves → signed in on Windows |
| 6 | Windows laptop + iPhone | **QR pairing** | Laptop `/connect` QR scanned with the iPhone **Camera app**; link opens in Safari; signs in if needed and **returns to the approval page**; code matching; Face ID approval; laptop shows "Connected to …" within about 3 seconds |
| 7 | Mac + Android | QR pairing | Same as 6 with Google Lens or the Camera app |
| 8 | Any phone on mobile data | Different-network approval | Amber "Different network" badge and the presence checkbox appear and are required |
| 9 | iPhone | Manual code entry | Devices → Connect a device → typed code works; keyboard shows capitals |
| 10 | Any | Revocation | Disconnect the laptop from the phone; the laptop's next navigation goes to sign-in |
| 11 | Any | Temporary expiry | Approve for 15 minutes; after 15 minutes the laptop is signed out on its next request |
| 12 | iPhone with VoiceOver, Android with TalkBack | Approval screen | Code choices, device type and permissions are announced; approve is reachable |
| 13 | iPhone SE (small screen) | All app screens | No clipping; bottom nav doesn't cover content; sticky approve bar respects the home indicator |

Known platform behaviour to watch:
- iOS opens QR links in the default browser. If that isn't Safari, the passkey must be available to that browser.
- Passkeys are bound to the preview hostname. A passkey made on the preview won't work on the future production domain.
- Some password managers intercept passkey creation. Check that 1Password or Bitwarden prompts don't break the flow.

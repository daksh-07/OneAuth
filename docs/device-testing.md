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

## Cloud and Space on real devices (developer preview)

**Status: not run.** No result below has been recorded. Run these on the hosted preview with **test files only**, and record each one as pass or fail with the device, OS version and browser version. The automated suites can't cover these behaviours: Playwright has no real Safari, iOS storage eviction or OS download handling.

| # | Device | Test | What to check | Why it matters |
| --- | --- | --- | --- | --- |
| C1 | iPhone, Safari (iOS 17+) | Create a vault, then close and reopen Safari the next day | Cloud unlocks without re-approval (device key survived in IndexedDB) | Safari can evict site data ("7-day cap" for sites not added to the Home Screen). If it evicts the key, the browser re-registers and needs approval or the recovery key. Note what happened |
| C2 | iPhone, Safari, **Private Browsing** | Open Cloud | Either works for the session, or shows a clear error; nothing persists after closing the tab | IndexedDB in private mode is ephemeral or unavailable |
| C3 | iPhone, Safari | Download an encrypted `.html` and a `.svg` test file | The file is **saved** (Files app) or shown as plain bytes; it is **never rendered as a page** on the OneAuth origin | Checks fix F6 (blob type) on the browser most likely to open blob URLs |
| C4 | Android, Chrome | Same as C3, plus a 20 MB file | Saved to Downloads; byte-identical (compare checksums); no tab crash | Memory use: downloads are assembled in memory |
| C5 | Two devices (iPhone + laptop) | Approve the phone from the laptop | Security codes match on both screens; after approval the **confirmation code** on the phone matches the laptop's dialog; the phone stays read-only until "Codes match" | G5 confirmation on real screens |
| C6 | Laptop | Remove the phone's vault access, replace the vault key **keeping the recovery key**, then re-encrypt existing files | Each step completes; the phone shows it has no access; existing files still download on the laptop | Rotation and deep rotation on real network conditions |
| C7 | Phone offline during C6, then back online | Open Cloud | If the phone kept access, it accepts the new key without asking (transition proof); if its access was removed, it says so | Offline-device behaviour |
| C8 | Laptop | Close the tab half-way through a key replacement, reopen | "A vault key replacement hasn't finished" appears; "Finish it in this browser" completes it | Resume after interruption |
| C9 | Any | "Remove this browser", then sign in again on the same browser | Cloud asks for approval again (device key deleted) | F10 on a real browser |
| C10 | Any | Clear site data while signed in, reload Cloud | A new approval request appears; old access isn't silently reused | Key loss handling |
| C11 | Phone + laptop | Add a bookmark on the laptop; watch the phone's Space page | It appears within about 20 seconds, or on switching back to the tab | Sync |
| C12 | Phone (390px) and tablet (820px) | Cloud and Space with a screen reader (VoiceOver, TalkBack) | Transfers, dialogs and codes are announced; every action is reachable | Accessibility beyond axe |

**WebCrypto support to note per device:** ECDH P-256 `deriveBits`, AES-KW, HKDF and non-extractable keys stored in IndexedDB. All are required. X25519 isn't used (see `cloud/key-rotation.md` §8 for why).

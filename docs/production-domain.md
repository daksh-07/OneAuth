# Production domain and passkey relying party

A passkey is bound to its **relying-party ID (RP ID)**, a domain. It works on that domain and its subdomains, and nowhere else. Changing the RP ID later means every user has to create a new passkey, so this is a one-way decision. **Decision needed from the owner before inviting real users.**

## How OneAuth uses it
- `ONEAUTH_ORIGINS`: the exact HTTPS origins allowed to run passkey ceremonies. The first is canonical; other hosts redirect to it.
- `ONEAUTH_RP_ID` (optional): the RP ID. Defaults to the canonical origin's hostname. If set, every origin must be that domain or a subdomain of it, otherwise the server refuses to run passkey ceremonies (unit-tested).

## Options

| Option | Example | Passkey portability | Verdict |
| --- | --- | --- | --- |
| **A. Own domain, apex RP ID** | RP ID `oneauth.example`; app at `app.oneauth.example` or the apex | Works across any subdomain you add later (app, account, admin). Survives a hosting move. | **Recommended** |
| B. Own domain, subdomain RP ID | RP ID `app.oneauth.example` | Locked to that one subdomain | Acceptable, less flexible |
| C. Vercel hostname | `oneauth-gamma.vercel.app` | Tied to a domain you don't own (`vercel.app` is a public suffix); can't be moved | **Don't use for real users** |
| D. Several brand domains | `.com` and `.com.au` | Needs one primary RP ID, plus WebAuthn *Related Origin Requests* (`/.well-known/webauthn`) for the others; browser support is recent | Later, if needed |

## What the preview does today
The preview uses its branch alias as the RP ID. Passkeys created there are for testing only and won't work on the production domain. That's intended.

## When the domain is chosen
1. Add it to the Vercel project (Production) and verify DNS.
2. Production env: `ONEAUTH_ORIGINS=https://app.<domain>` (plus the apex if served), `ONEAUTH_RP_ID=<domain>`.
3. Connect a **separate** production database and set `ONEAUTH_DATABASE_ENV=production` for Production only. The build refuses otherwise.

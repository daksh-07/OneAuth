# Product vision

**Promise:** Your digital life. One identity. Any compatible device.

People own several devices across ecosystems, borrow others, and rebuild their digital environment each time. OneAuth makes a person's *authorised* digital environment portable: selective, revocable, and understandable without knowing what OAuth or a public key is.

## Mental model

Your phone is the **control centre** for access to your identity. It isn't a skeleton key: it approves and revokes access through OneAuth's own systems and through integrations that services officially support.

## Pillars

| Pillar | Purpose | Status |
| --- | --- | --- |
| **Identity** | Passkey account, trusted devices, step-up verification, security history | Built (web) |
| **Connect** | QR pairing, owned and temporary devices, expiry, revocation | Built (web) |
| **Cloud** | Client-side encrypted file storage | Not started: blocked on key-management and recovery design review |
| **Space** | Portable workspace: pinned files, bookmarks, preferences | Not started: depends on Cloud |

## What we will not do

- Pretend to sign users in to Apple, Google, Microsoft, Netflix etc. without a supported mechanism.
- Extract cookies, bypass device restrictions or inject third-party credentials.
- Call anything "unhackable", "100% secure" or "zero-knowledge" before an independent review.
- Present planned features, mock data or proposed prices as real.

## Audiences, in order

1. Everyday multi-device users (initial focus, Australia first).
2. Frequent travellers: temporary access to shared screens. Product support exists; hardware partnerships don't.
3. Professionals moving between workstations.
4. Hotels and enterprises: future, only after the consumer product is proven and partnerships exist.

## Business hypotheses (unvalidated)

Free, Personal Pro (proposed A$8.99/month with 100 GB), storage add-on (A$3.99/month per 100 GB), Family, and custom Business/Hospitality pricing. These live in `lib/plans.ts` as configuration. No payment provider is connected. Identity, storage and enterprise entitlements stay separate so each can be re-priced independently.

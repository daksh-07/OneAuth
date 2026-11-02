# OneAuth

**Your digital life. One identity. Any compatible device.**

OneAuth is a passkey-based identity that lets you approve devices from your phone, give each one exactly the access you choose for as long as you choose, and revoke it at any time. This repository holds the web application: the first vertical slice of the product.

> Status: early preview. Identity, device pairing, temporary access and revocation work end-to-end against Postgres. Encrypted cloud storage, the portable workspace, account recovery and native apps are **not built yet**. See [docs/limitations.md](docs/limitations.md).

## Quick start

```bash
cp .env.example .env.local          # set DATABASE_URL
npm install
npm run db:migrate                  # applies db/migrations/*.sql
npm run dev                         # http://localhost:3000
```

Passkeys need a secure context: `localhost` works in development; any hosted origin must be HTTPS and listed explicitly in `ONEAUTH_ORIGINS`. Deployment URLs are never trusted implicitly. See [deployment](docs/deployment.md).

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | TypeScript strict mode |
| `npm run lint` | ESLint (Next core-web-vitals and TypeScript) |
| `npm test` | Vitest: unit, contrast and Postgres integration tests (needs `TEST_DATABASE_URL` or a local `oneauth_test` DB) |
| `npm run test:e2e` | Playwright: real passkey ceremonies via Chrome's virtual authenticator, two-device pairing, axe accessibility, screenshots; plus iPhone/WebKit, Pixel/Chromium, Firefox and WebKit cross-browser checks (needs a built app and a local `oneauth_e2e` DB) |
| `npx playwright test -c playwright.hosted.config.ts` | The same journeys against a deployed preview (see [deployment](docs/deployment.md)) |

## Documentation

- [Product vision](docs/product-vision.md) · [MVP definition](docs/mvp.md) · [User journeys](docs/user-journeys.md)
- [Technical architecture](docs/architecture.md) · [Security model and threat model](docs/security-model.md)
- [Design system](docs/design-system.md) · [Roadmap](docs/roadmap.md) · [Implementation checklist](docs/checklist.md)
- [Known limitations and dependencies](docs/limitations.md) · [Competitive positioning](docs/competitive-landscape.md)
- [Deployment and environments](docs/deployment.md) · [Production domain and RP ID](docs/production-domain.md) · [Device and browser testing](docs/device-testing.md)
- Proposal: [OneAuth Cloud encryption](docs/proposals/cloud-encryption.md) (draft, pending review)

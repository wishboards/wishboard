# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#492](https://github.com/wishboards/wishboard/issues/492)** — Upgrade to TypeScript 7 once `typescript-eslint` widens its peer dependency range (`>=4.8.4 <6.1.0`), unblocking the Dependabot TS 7 bump.
- **[#531](https://github.com/wishboards/wishboard/issues/531)** — Drop Storage prototype test polyfill when JSDOM supports Node 25+ uninitialized `globalThis.localStorage` or Node 24 is retired.

### Features & Enhancements

- **[#332](https://github.com/wishboards/wishboard/issues/332)** — Decomposable & Optional AI Integration: Implement `InferenceProvider` / `EmbeddingProvider` interfaces, async tagging worker, UX suggestion badges, and optional vector search (see [ADR 0007](docs/src/content/docs/adr/0007-ai-integration.md)).

## Infrastructure & DevOps

- **[#238](https://github.com/wishboards/wishboard/issues/238)** — Implement automated database and media backups across both deployment targets: periodically snapshot the SQLite database (Turso point-in-time restore / dump on Serverless, `./data/db` on Pi Kiosk) and uploaded images (`AWS_S3_BUCKET` on Serverless, `./data/images` on Pi Kiosk).
- **[#314](https://github.com/wishboards/wishboard/issues/314)** — Automated database and media backup recovery testing: periodically restore snapshots into a temporary database to verify recoverability (follow-up to #238).
- **[#398](https://github.com/wishboards/wishboard/issues/398)** — UI Component Documentation (ADR-0008 Phase 3): Implement Storybook for UI isolation and accessibility testing.
- **[#399](https://github.com/wishboards/wishboard/issues/399)** — Automate external site bootstrapping: Expand the CLI to seamlessly provision SonarCloud, Stryker, AWS OIDC roles, and GitHub secrets for a frictionless fork deployment experience.

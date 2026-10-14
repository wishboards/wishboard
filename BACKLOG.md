# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#492](https://github.com/wishboards/wishboard/issues/492)** — Upgrade to TypeScript 7 once `typescript-eslint` widens its peer dependency range (`>=4.8.4 <6.1.0`), unblocking the Dependabot TS 7 bump.
- **[#519](https://github.com/wishboards/wishboard/issues/519)** — Upgrade to Vitest 5 once `@stryker-mutator/vitest-runner` supports Vitest 5's testNamePattern separator (`>`), unblocking the Dependabot Vitest 5 bump.

### Features & Enhancements

- **[#312](https://github.com/wishboards/wishboard/issues/312)** — Offload OpenCV frame processing in `WishScanner` to a Web Worker to maintain smooth 60fps UI rendering on lower-power devices.
- **[#332](https://github.com/wishboards/wishboard/issues/332)** — Decomposable & Optional AI Integration: Implement `InferenceProvider` / `EmbeddingProvider` interfaces, async tagging worker, UX suggestion badges, and optional vector search (see [ADR 0007](docs/adr/0007-ai-integration.md)).

## Infrastructure & DevOps

- **[#238](https://github.com/wishboards/wishboard/issues/238)** — Implement automated database and media backups: periodically snapshot the SQLite database (Turso point-in-time restore vs. `turso db dump` exports) and S3 uploaded images.
- **[#314](https://github.com/wishboards/wishboard/issues/314)** — Automated database and media backup recovery testing: periodically restore snapshots into a temporary database to verify recoverability (follow-up to #238).
- **[#398](https://github.com/wishboards/wishboard/issues/398)** — UI Component Documentation (ADR-0008 Phase 3): Implement Storybook for UI isolation and accessibility testing.
- **[#399](https://github.com/wishboards/wishboard/issues/399)** — Automate external site bootstrapping: Expand the CLI to seamlessly provision SonarCloud, Stryker, AWS OIDC roles, and GitHub secrets for a frictionless fork deployment experience.

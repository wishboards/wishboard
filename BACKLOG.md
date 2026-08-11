# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#180](https://github.com/wishboards/wishboard/issues/180)** — Upgrade to ESLint 10 once `eslint-plugin-react` supports it (currently pinned to 9.x; Dependabot 10.x updates ignored). A weekly CI watcher (#181) pings this issue when the upstream peers unblock.
- **[#313](https://github.com/wishboards/wishboard/issues/313)** — Add Playwright E2E tests for `WishScanner` using a fake video stream fixture depicting a 3x5 wish card on a flat surface.

### Database & Deployment

- **[#270](https://github.com/wishboards/wishboard/issues/270)** — Pin `libsql-server` to v0.24.32 due to stats file permission error (`Permission denied (os error 13)`) under Rootless Docker volume mounts. Keep open until an upstream release resolves stats file persistence.

### Features & Enhancements

- **[#312](https://github.com/wishboards/wishboard/issues/312)** — Offload OpenCV frame processing in `WishScanner` to a Web Worker to maintain smooth 60fps UI rendering on lower-power devices.
- **[#330](https://github.com/wishboards/wishboard/issues/330)** — Rules Engine Extraction Phase 1: Decouple matching engine logic from `wishes.js` into an isolated internal module `src/server/engine/` (see [ADR 0006](docs/adr/0006-extract-rules-engine.md)).
- **[#331](https://github.com/wishboards/wishboard/issues/331)** — Rules Engine Extraction Phase 2: Extract internal engine module into a standalone open-source library under the `wishboards` GitHub org / npm (`@wishboards/matching-engine`) (see [ADR 0006](docs/adr/0006-extract-rules-engine.md)).
- **[#332](https://github.com/wishboards/wishboard/issues/332)** — Decomposable & Optional AI Integration: Implement `InferenceProvider` / `EmbeddingProvider` interfaces, async tagging worker, UX suggestion badges, and optional vector search (see [ADR 0007](docs/adr/0007-ai-integration.md)).

### Documentation

- **[#434](https://github.com/wishboards/wishboard/issues/434)** — Refresh the matching rules page: it has drifted from the profile-driven implementation, where seed defaults live in `profiles/**/profile.yaml` (see [ADR 0005](docs/src/content/docs/adr/0005-matching-engine-generalization.md)).
- **[#435](https://github.com/wishboards/wishboard/issues/435)** — Drop the legacy `rules.yaml` migration references from the docs; that path is many versions obsolete now that rules are seeded from profiles and edited via the admin UI.

## Infrastructure & DevOps

- **[#238](https://github.com/wishboards/wishboard/issues/238)** — Implement automated database and media backups: periodically snapshot the SQLite database (Turso point-in-time restore vs. `turso db dump` exports) and S3 uploaded images.
- **[#314](https://github.com/wishboards/wishboard/issues/314)** — Automated database and media backup recovery testing: periodically restore snapshots into a temporary database to verify recoverability (follow-up to #238).
- **[#262](https://github.com/wishboards/wishboard/issues/262)** — Root Domain Redirector: Create a small redirector for the bare domain (e.g. `wishboards.app`) to either redirect to the demo deployment or present a landing page selecting among currently deployed active stacks.
- **[#335](https://github.com/wishboards/wishboard/issues/335)** — Clean up legacy orphaned repository variables (`DOMAIN_NAME`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN_SSM`, `AWS_STACK_NAME`) following matrix workflow migration.

- **[#344](https://github.com/wishboards/wishboard/issues/337)** — Automated API Documentation (ADR-0008 Phase 1): Adopt Zod and Scalar for live OpenAPI specs.
- **[#398](https://github.com/wishboards/wishboard/issues/338)** — UI Component Documentation (ADR-0008 Phase 3): Implement Storybook for UI isolation and accessibility testing.
- **[#399](https://github.com/wishboards/wishboard/issues/339)** — Automate external site bootstrapping: Expand the CLI to seamlessly provision SonarCloud, Stryker, AWS OIDC roles, and GitHub secrets for a frictionless fork deployment experience.

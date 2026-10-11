# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#180](https://github.com/wishboards/wishboard/issues/180)** — Upgrade to ESLint 10. React plugin migrated to `@eslint-react/eslint-plugin`, unblocking the ESLint 10 upgrade. (Still partially blocked by `typescript-eslint` TS 7 peers if tracking TS 7).
- **[#313](https://github.com/wishboards/wishboard/issues/313)** — Add Playwright E2E tests for `WishScanner` using a fake video stream fixture depicting a 3x5 wish card on a flat surface.

### Database & Deployment

- **[#270](https://github.com/wishboards/wishboard/issues/270)** — Pin `libsql-server` to v0.24.32 due to stats file permission error (`Permission denied (os error 13)`) under Rootless Docker volume mounts. Keep open until an upstream release resolves stats file persistence.

### Features & Enhancements

- **[#312](https://github.com/wishboards/wishboard/issues/312)** — Offload OpenCV frame processing in `WishScanner` to a Web Worker to maintain smooth 60fps UI rendering on lower-power devices.
- **[#330](https://github.com/wishboards/wishboard/issues/330)** — Rules Engine Extraction Phase 1: Decouple matching engine logic from `wishes.js` into an isolated internal module `src/server/engine/` (see [ADR 0006](docs/adr/0006-extract-rules-engine.md)).
- **[#331](https://github.com/wishboards/wishboard/issues/331)** — Rules Engine Extraction Phase 2: Extract internal engine module into a standalone open-source library under the `wishboards` GitHub org / npm (`@wishboards/matching-engine`) (see [ADR 0006](docs/adr/0006-extract-rules-engine.md)).
- **[#332](https://github.com/wishboards/wishboard/issues/332)** — Decomposable & Optional AI Integration: Implement `InferenceProvider` / `EmbeddingProvider` interfaces, async tagging worker, UX suggestion badges, and optional vector search (see [ADR 0007](docs/adr/0007-ai-integration.md)).

### Kiosk & Big Screen Display

- **[#484](https://github.com/wishboards/wishboard/issues/484)** — Keep Wi-Fi QR code permanently visible on kiosk display (`WiFiQrCode`): prevent cycling off after 30s so attendees can always connect to the hotspot.
- **[#485](https://github.com/wishboards/wishboard/issues/485)** — Trigger captive portal onboarding on Wi-Fi connection: configure captive portal redirection / RFC 8908 triggers on the hotspot to guide connecting devices directly to the Wishboard web portal.
- **[#486](https://github.com/wishboards/wishboard/issues/486)** — Proportionally scale typography with card dimensions on big screen display: scale font sizes inside `.display-card` and `.wish-text` dynamically to match card width/height on large monitors.
- **[#487](https://github.com/wishboards/wishboard/issues/487)** — Split screen layout between cards grid and onboarding instructions: dedicate ~75–80% of kiosk viewport to the active cards grid, and reserve ~20–25% for a persistent sidebar/panel with instructions and QR code.
- **[#488](https://github.com/wishboards/wishboard/issues/488)** — Increase visual contrast between corkboard background and cards: deepen corkboard tones, define card borders, and enhance drop shadows to ensure cards stand out clearly on high-ambient-light displays.
- **[#489](https://github.com/wishboards/wishboard/issues/489)** — Enlarge Wi-Fi QR code dimensions for easy scanning: increase the QR code SVG size to 240px–320px so smartphone cameras can reliably scan it from standing viewing distance.
- **[#490](https://github.com/wishboards/wishboard/issues/490)** — Display event and board title on kiosk display: restore and style an event and board title banner on the kiosk display so viewers have immediate context.

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

# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#492](https://github.com/wishboards/wishboard/issues/492)** — Upgrade to TypeScript 7 once `typescript-eslint` widens its peer dependency range (`>=4.8.4 <6.1.0`), unblocking the Dependabot TS 7 bump.
- **[#531](https://github.com/wishboards/wishboard/issues/531)** — Drop Storage prototype test polyfill when JSDOM supports Node 25+ uninitialized `globalThis.localStorage` or Node 24 is retired. _(Partially completed: `jsdom` bumped to `^31.0.1`; polyfill retained pending upstream resolution or Node 24 retirement in April 2027)._

### AI Suggestion Review UX (ADR 0012)

- **[#644](https://github.com/wishboards/wishboard/issues/644)** — Epic: AI Suggestion Review UX, Scope Control & Sticker-Aware Streamlining (ADR 0012).
  - **[#642](https://github.com/wishboards/wishboard/issues/642)** — Phase 2: Signed-in scope control (This Wish vs. Account Profile) & profile conflict detection.
  - **[#643](https://github.com/wishboards/wishboard/issues/643)** — Phase 3: Sticker-aware & filler-trimming wish streamlining, Storybook, E2E & full documentation.

# Wishboard Backlog

This document tracks feature requests, technical debt, and future improvements that are planned but not yet implemented.

## Open GitHub Issues

Enhancement and technical-debt work tracked as issues, for traceability:

### Testing & Quality

- **[#492](https://github.com/wishboards/wishboard/issues/492)** — Upgrade to TypeScript 7 once `typescript-eslint` widens its peer dependency range (`>=4.8.4 <6.1.0`), unblocking the Dependabot TS 7 bump.
- **[#531](https://github.com/wishboards/wishboard/issues/531)** — Drop Storage prototype test polyfill when JSDOM supports Node 25+ uninitialized `globalThis.localStorage` or Node 24 is retired. _(Partially completed: `jsdom` bumped to `^31.0.1`; polyfill retained pending upstream resolution or Node 24 retirement in April 2027)._

### Features & Enhancements

- **[#332](https://github.com/wishboards/wishboard/issues/332)** — Decomposable & Optional AI Integration: Implement `InferenceProvider` / `EmbeddingProvider` interfaces, async tagging worker, UX suggestion badges, and optional vector search (see [ADR 0007](docs/src/content/docs/adr/0007-ai-integration.md)).

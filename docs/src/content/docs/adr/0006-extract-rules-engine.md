---\ntitle: 0006 Extract Rules Engine\n---\n# ADR 0006: Decoupling and Extracting the Rules Engine

- **Status:** Proposed
- **Date:** 2026-08
- **Context Date:** 2026-08

## Context

Wishboard's rules engine processes complex identity matching logic, including attribute expansion, enrichment, acceptance, exclusion, and cross-matching across categories (`gender`, `orientation`, `role`, etc.).

An investigation of existing open-source rule engines confirmed that while generic Business Rule Engines (e.g., Drools, `json-rules-engine`) and Entity Resolution tools (e.g., Splink, Dedupe) exist, there are no open-source libraries specifically designed for identity-based, bidirectional matchmaking logic.

Currently, this core evaluation logic resides inside [wishes.js](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js) and is tightly coupled with Express request handlers and direct database queries from [rulesManager.js](file:///c:/Users/pltho/wishboard/src/server/rulesManager.js).

To allow this unique matchmaking engine to be reused in other applications and to establish a clean architecture, we want to extract the matching engine into a separate Node.js library published under the `wishboards` GitHub organization.

## Decision & Phased Approach

We will execute this extraction in two distinct phases to manage complexity and verify API boundaries before publishing external packages.

### Phase 1: Internal Module Decoupling (Monolithic Extraction)

1. **Isolate Pure Logic**: Refactor the matching helpers from `src/server/routes/wishes.js` (`isCompatible`, `getExpandedDesired`, `getExclusionConflicts`, `evaluateRuleConditions`, `enrichAttributes`, `buildAcceptedSet`, `applyCrossRule`) into a pure JavaScript module under `src/server/engine/`.
2. **Zero IO / Framework Dependencies**: The engine module will have no dependencies on Express, SQLite, or disk IO. It will accept pure JavaScript arrays/objects (e.g. active rule sets, user profiles, wish attributes) and return boolean evaluations or enriched attribute sets.
3. **Database & API Layering**: `rulesManager.js` will remain in Wishboard to handle database persistence, cache rehydration, and TTL reloading, passing raw rule objects into the pure engine.
4. **Comprehensive Unit Testing**: The internal module will be backed by thorough isolated unit tests.

### Phase 2: Standalone Library Extraction & Publishing

1. **Repository Creation**: Create a new standalone repository under the `wishboards` GitHub organization (e.g., `wishboards/matching-engine`).
2. **NPM Package**: Package the pure engine module with TypeScript definitions and publish it as an npm package (e.g., `@wishboards/matching-engine`).
3. **Wishboard Dependency**: Replace the internal `src/server/engine/` module in Wishboard with the external npm package dependency.

## Consequences & Next Steps

- **Architectural Cleanliness**: Wishboard's route handlers become thinner and focused strictly on HTTP and database operations.
- **Community Impact**: Offers the open-source ecosystem a standalone, zero-dependency identity matchmaking engine.
- **Tracking**: Phase 1 is tracked via [#330](https://github.com/wishboards/wishboard/issues/330). Phase 2 is tracked via [#331](https://github.com/wishboards/wishboard/issues/331) and documented in `BACKLOG.md` to be executed once the internal module API stabilizes.

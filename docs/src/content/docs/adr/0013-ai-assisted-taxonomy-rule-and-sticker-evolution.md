---
title: 'ADR 0013: AI-Assisted Taxonomy, Rule, and Sticker Evolution'
sidebar:
  label: 0013 AI Taxonomy & Rule Evolution
---

- **Status:** Accepted
- **Date:** 2026-11
- **Extends:** [ADR 0012: AI Suggestion Review UX and Streamlining](../0012-ai-suggestion-review-ux-and-streamlining/)

## Context

Wishboard's matching quality and card presentation rely on three coupled configuration layers:

1. **Categories & Suggestions (`categories`):** Structured facet buckets (`gender`, `orientation`, `role`, `interests`, etc.) read by `LocalProvider` and `CloudProvider` (`src/server/ai/LocalProvider.js`, `src/server/ai/CloudProvider.js`) and rendered in the wish-creation picker.
2. **Matching Rules (`rules`):** Five deterministic rule types persisted in SQLite (`rules` table in `src/server/db.js`, cached in `src/server/rulesManager.js` with `RULES_CACHE_TTL_MS` defaulting to `60s`): `enrichment`, `acceptance`, `expansion`, `cross_match`, and `exclusion`.
3. **Visual Stickers (`stickers`):** Identity and interest badges observed in `.storybook/preview.ts` and `src/client/src/components/IdentityStickers.tsx`, combining CSS-coupled types (`heart` + `flag-*`, `flag` + `flag-*`, `icon` + `iconType`) and asset-backed images (`type: 'image'`, `src: '/assets/...'`).

Supporting romantic, ENM/polyamorous, LGBTQIA+, and BDSM/kink communities exposes three architectural gaps:

- **Static taxonomy drift:** Providers read `profile.categories` and `profile.stickers` as fixed inputs. Valid community terminology outside the seeded profile (e.g., _service top_, _rope bunny_, _kitchen table poly_, _demiromantic_) is either dropped or left as unstructured prose.
- **Asymmetric mutability:** `rules` are already runtime-mutable in SQLite, whereas CSS-class stickers are coupled to bundled stylesheets/React components and cannot safely be introduced at runtime without an asset/SVG-safe pipeline.
- **License hygiene across external catalogs:** Public kink and pride repositories vary from permissive (`CC0-1.0`, `MIT`, `Apache-2.0`) to restricted (`CC BY-NC-SA 4.0`) and strong network copyleft (`AGPL-3.0-or-later`).

## External Catalogs & Licensing Audit

| Source                                                                                                    | Domain Coverage                                                      | License                   | Policy Decision                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`fetlife/translations`](https://github.com/fetlife/translations) (`locales/en.yml` + 20+ locales)        | Roles, genders, orientations, relationship-status labels & i18n keys | **Apache-2.0**            | **Approved reference/seed** with Apache-2.0 attribution; do not reuse FetLife trademarks/branding.                                     |
| [`fetlife/android`](https://github.com/fetlife/android) / `fetlife/ios` (legacy open-source mobile repos) | Legacy client models/enums                                           | **MIT**                   | **Reference only** (historical schema baseline).                                                                                       |
| [`Goctionni/kinklist-v2`](https://github.com/Goctionni/kinklist-v2)                                       | Structured BDSM/kink preference categories & practices               | **MIT**                   | **Approved seed** for BDSM practice/interest categories and `enrichment`/`expansion` rules with MIT attribution.                       |
| [`ContribuLibre/check-match`](https://github.com/ContribuLibre/check-match)                               | Extended compatibility & polarity/limit inheritance model            | **GNU AGPL-3.0-or-later** | **Code/assets excluded** (AGPL network-copyleft conflict). Safe for conceptual design patterns only (e.g., giving/receiving polarity). |
| [`Yellow-Dog-Man/PrideFlags`](https://github.com/Yellow-Dog-Man/PrideFlags)                               | LGBTQIA+ pride flags, badges, SVG/PNG icons                          | **CC0-1.0**               | **Approved asset pack** for orientation/gender/relationship-style stickers.                                                            |
| [`prideraiser/flags`](https://github.com/prideraiser/flags) (`@prideraiser/flags`)                        | 36 LGBTQ+ pride flag SVG components                                  | **MIT**                   | **Approved geometry/palette reference** with MIT attribution.                                                                          |
| [`microsoft/Pride-flag`](https://github.com/microsoft/Pride-flag)                                         | 74 LGBTQIA+ community flag definitions                               | **CC BY-NC-SA 4.0**       | **Assets excluded** (NonCommercial + ShareAlike conflict); label inventory used for gap awareness only.                                |

## Decision Drivers

1. `@wishboards/matching-engine` must remain pure, synchronous, zero-dependency, and AI-free.
2. AI must support the full rule model (`enrichment`, `acceptance`, `expansion`, `cross_match`, `exclusion`), not just flat tags.
3. No identity tag, relationship rule, exclusion, or sticker may become active without explicit human/admin review.
4. Raspberry Pi deployments running `LocalProvider` must stay fully functional offline while still benefiting from statically curated profile updates.
5. Runtime-added stickers must be visually consistent and XSS-safe without requiring frontend CSS deploys.

## Decision

We adopt **Option 3: Hybrid Two-Loop Architecture (Static Bootstrap + Runtime Gap Harvester → Unified Admin Governance Queue)**.

### Architecture Overview

1. **Loop A — Static Bootstrap & Offline Profile Analyzer (CLI / Dev / Admin Batch):**
   - Inspects existing `profiles/*` YAML, permissive seed packs (`fetlife/translations`, `kinklist-v2`, `PrideFlags`), and optional anonymized board exports.
   - Proposes structured `categories`, synonym `expansion`/`enrichment` mappings, complementary `cross_match`/`acceptance`/`exclusion` pairs, and matching `CC0`/`MIT` SVG stickers.
   - Runs static rule-graph conflict validation before producing Git PRs or importable profile bundles.

2. **Loop B — Bounded Runtime Gap Harvester (Async Post-Tagging Hook):**
   - Extends `CloudProvider` structured extraction (and an optional deterministic unmatched-phrase collector in `LocalProvider`) to emit `unmappedSignals` alongside ADR 0012 suggestions.
   - Aggregates **only normalized candidate terms/rule tuples and counts** into a `taxonomy_proposals` SQLite table—never storing linking `wishId`s or verbatim user sentences—with a configurable quorum threshold (default `>= 3` occurrences) before surfacing in primary triage.

3. **Unified Admin Governance & Dual Promotion:**
   - **Immediate Runtime Promotion:** Approved `rules` write directly to SQLite `rules` (active within `RULES_CACHE_TTL_MS = 60s`). Approved `categories`/`suggestions` and validated declarative SVG/image stickers persist as DB profile overrides layered over base YAML in `configManager`.
   - **Sticker Pipeline:** Proposals resolve first against bundled `CC0`/`MIT` SVGs (`/assets/stickers/*.svg`); any AI-synthesized fallback must conform to a constrained geometric SVG template stripped by a strict tag/attribute allowlist sanitizer (`viewBox`, `path`, `circle`, `rect`, `polygon` only—zero scripts, event handlers, external references, or `<foreignObject>`).
   - **Upstream Git Export:** Admins can export approved DB overrides as profile YAML/SVG patches so proven live-event discoveries graduate into versioned profiles (and ship to offline Pi boards on upgrade).

## Architectural Boundary (`wishboard` vs. `@wishboards/matching-engine`)

- **`@wishboards/matching-engine`:** Remains completely AI-free and zero-dependency. Adds only a deterministic **Rule Graph Validator** (detecting `expansion` cycles, direct `cross_match`/`exclusion` contradictions, and dangling/empty targets) shared by Loop A CI checks and Loop B admin approvals.
- **`wishboard`:** Owns LLM prompts, `taxonomy_proposals` storage, privacy/quorum enforcement, DB-over-YAML config layering, SVG sanitization, admin triage UI, and YAML export.

## Alternatives Considered (Rank-Ordered)

1. **Rank #1 — Option 3: Hybrid Two-Loop Architecture (Accepted):** Combines cold-start domain completeness and license safety from static curation with live community adaptability under quorum + human governance.
2. **Rank #2 — Option 1: Static / Offline Analyzer Only:** Safest runtime footprint and simplest implementation, but slow to adapt to live event slang and blind to real zero-match failures without manual log exports.
3. **Rank #3 — Option 2: Runtime Wish-Driven Proposal Queue Only:** Fast adaptation to live phrasing, but weak cold-start ontology for BDSM/ENM/queer nuances, noisy on small boards, ineffective on offline Pi (`LocalProvider`), and weak for coherent visual sticker curation.

## Consequences

- **Positive:** Safely expands romantic, ENM, queer, and BDSM matching using license-vetted sources; closes the feedback loop between live boards and static profiles; keeps Pi offline parity intact.
- **Negative / Trade-offs:** Adds `taxonomy_proposals` persistence, DB-over-YAML override layering in `configManager`, an admin review UI surface, and SVG sanitization tests; requires targeted Stryker mutation testing and license provenance checks.

## Tracking

- [ ] Epic: AI-Assisted Taxonomy, Rule, and Sticker Evolution (`wishboards/wishboard#659`)
- [ ] Phase 0 / Engine: Deterministic rule-graph validator (`wishboards/matching-engine#105`)
- [ ] Phase 1: License-vetted seed catalogs, static profile analyzer CLI, and curated profile updates (`wishboards/wishboard#660`)
- [ ] Phase 2: Declarative SVG sticker pipeline & DB-over-YAML config override layer (`wishboards/wishboard#661`)
- [ ] Phase 3: Runtime gap harvester (`taxonomy_proposals`) & Admin Governance Queue UI (`wishboards/wishboard#662`)
- [ ] Phase 4: Sticker auto-matching, sanitized SVG synthesis, YAML export, and end-to-end validation (`wishboards/wishboard#663`)

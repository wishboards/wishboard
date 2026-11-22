---
title: 0012 AI Suggestion Review UX, Scope Control & Sticker-Aware Streamlining
---

# ADR 0012: AI Suggestion Review UX, Scope Control & Sticker-Aware Streamlining

- **Status:** Accepted (Phase 1 implemented; Phases 2–3 planned)
- **Date:** 2026-11
- **Context Date:** 2026-11
- **Extends:** [ADR 0007: Decomposable & Optional AI Integration](../0007-ai-integration/), [ADR 0011: Dual-Persona Skinning & Mobile Companion UX](../0011-theming-skinning-and-mobile-companion-ux/)

## Context

[ADR 0007](../0007-ai-integration/) established Wishboard's optional, asynchronous AI tagging and semantic search architecture (`NoopProvider`, offline `LocalProvider`, and `CloudProvider`) along with a basic human-in-the-loop review modal (`AiSuggestionModal`).

Live deployments (including `ai.wishboards.app`) and multi-device UX audits across phones, tablets/kiosks, and desktops revealed five critical user-experience and matching-engine challenges:

1. **Matching Engine Trap with Desired Attributes:**
   In `@wishboards/matching-engine`, empty `desired_attributes` let the engine evaluate inclusive bidirectional rules (`acceptance`, `enrichment`, and `cross_match`). Explicitly populating `desired_attributes` switches that category into a **strict filter** that overrides implicit matching. Blindly accepting AI-suggested desired attributes on a wish (especially for signed-in users whose profile already drives inclusive matching) can unintentionally exclude compatible convention matches.
2. **Signed-In Scope Ambiguity (Single Wish vs. Account Profile):**
   Signed-in attendees often post situational wishes (e.g., a `Switch` posting a single card specifically to `Bottom`) while at other times wishing to enrich an incomplete Account Profile directly from an AI suggestion. Without an explicit scope control, users cannot tell whether accepting creator suggestions alters only the current card or their persistent identity.
3. **Late Conflict Surprises (HTTP 400):**
   When an AI suggestion conflicts with an existing wish or profile attribute under `exclusion` rules (e.g., `gay` vs. `straight`), users previously only discovered the conflict as an error after clicking Accept/Save.
4. **Card Economy & Non-Lossy Text Streamlining:**
   Physical and digital 3×5 index cards have fixed proportions (`useTextFit` shrinks font size and flags overflow when copy is verbose). When self-descriptors move into visual card stickers (`IdentityStickers` driven by `profile.stickers`), repeating those exact labels—or card-redundant greetings like `"Hey all,"` (the card itself is the "hey all")—wastes card space. However, naive rewording risks deleting **unstructured details** (such as age like `30yo`, location, timing, or boundaries) or **non-stickered structured attributes** (such as `role: Switch` in the `lifestyle` profile, which has no visual sticker, or `desired_attributes`).
5. **Multi-Device Ergonomics & Theme Consistency:**
   The initial `AiSuggestionModal` edited suggestions via comma-separated text inputs inside a hardcoded light-mode `.kiosk-modal`, which is awkward on mobile/kiosk on-screen keyboards and clashes with Wishboard's dark Midnight Lounge and Corkhouse themes ([ADR 0011](../0011-theming-skinning-and-mobile-companion-ux/)).

## Decision

We will evolve Wishboard's AI suggestion review experience across **three independently deliverable phases**, preserving strict decoupling between the host app (`wishboard`) and `@wishboards/matching-engine`.

### Phase 1: Interactive Chips, Desired-Attribute Guardrails, Client Conflict Pre-Validation & Responsive Multi-Device UX

1. **Tap-to-Toggle Attribute Chips (`>= 44px` Touch Targets):**
   - Replace comma-separated text fields in `AiSuggestionModal` with touch-friendly toggle chips grouped by event-profile category, plus a compact taxonomy-assisted **+ Add tag** picker.
2. **Opt-In Desired Attributes Guardrail:**
   - Creator attribute suggestions default to **selected** (opt-out).
   - Desired attribute suggestions default to **unselected** (opt-in) with an explicit educational note explaining Wishboard's implicit matching rules vs. strict desired filters.
   - Selecting any desired attribute displays a live inline match-impact notice.
3. **Real-Time Client-Side Conflict Pre-Validation & Inline Resolution:**
   - Serve live DB matching rules from `GET /api/config` (`EventProfileContext`) and invoke `@wishboards/matching-engine`'s zero-dependency `getExclusionConflicts` synchronously during render (no round-trip latency, works offline on kiosks).
   - Surface exclusion conflicts inline with one-tap resolution actions (**Keep existing** vs. **Replace with suggested**), disabling submission until conflicts are resolved so attendees never encounter surprise 400 responses.
4. **Responsive Multi-Device Presentation & `--wb-*` Theming:**
   - **Mobile (`< 640px`):** Renders inside Wishboard's reusable `<BottomSheet>` drawer with swipe-down dismissal, thumb-sized chips, and a collapsible live `WishCard` preview.
   - **Tablet / Kiosk (`640px–1024px`):** Centered themed modal with an embedded live `WishCard` preview above the controls.
   - **Desktop (`> 1024px`):** Two-column themed modal with suggestion controls on the left and a sticky live `WishCard` preview on the right updating stickers in real time.

### Phase 2: Signed-In Scope Control (This Wish Only vs. Account Profile)

1. **Least-Privilege Default:**
   - For anonymous wishes, creator attributes apply directly to `wishes.creator_attributes`.
   - For signed-in attendees, `AiSuggestionModal` defaults to **Apply to this wish only** and offers an explicit opt-in checkbox: **Also update my Account Profile (saves for future wishes)**.
   - If the AI suggests a creator attribute in a category currently empty on the user's Account Profile, show a contextual helper nudge.
2. **Dual Conflict Validation (Wish + Account Profile):**
   - When **Also update my Account Profile** is checked, validate exclusion conflicts against both the wish's resolved creator attributes and the merged Account Profile `identity_attributes`, offering inline profile conflict resolution before submission.
3. **Contract-Typed API Persistence:**
   - Extend `POST /api/wishes/:id/suggestions/:action` (`WishAiSuggestionActionInput`) with optional `update_profile?: boolean` and `profile_attributes?: Record<string, string[]>`, requiring Bearer-token authentication when `update_profile: true`, validating via `getExclusionConflicts`, updating `users.identity_attributes`, and returning `profile_updated` so the client calls `AuthContext.refreshUser()`.

### Phase 3: Strict Non-Lossy, Sticker-Aware Wish Streamlining

1. **Strict Non-Lossy Streamlining Contract:**
   - Streamlined text suggestions **must never** eliminate:
     - Unstructured details with no structured field or sticker (e.g., age like `30yo`, location, dates/times, specific interests, boundaries, humor, tone).
     - Structured attributes that do **not** render as visual stickers in the active event profile (e.g., `role` terms like `switch` in `lifestyle`, or `desired_attributes` like `"looking for another switch"`).
   - Streamlined text **may only** propose removing:
     1. Creator self-descriptors that **explicitly map to a visual sticker** configured in the active profile's `stickers` config (passed directly into `InferenceProvider.suggestAttributes`).
     2. Demonstrably redundant card-opening/closing conversational filler (e.g., `"Hey all,"`, `"Hi everyone!"`, `"Hello wishboard,"`)—because the card itself serves as the greeting.
2. **Dual-Target Provider Support:**
   - Persist `suggested_content TEXT` on `wish_ai_suggestions` via backward-compatible `ensureColumn` (`src/server/db.js`).
   - `CloudInferenceProvider` uses the active profile's sticker-backed term map and strict non-lossy prompt rules to produce an optional `suggestedContent`.
   - `LocalInferenceProvider` (offline Raspberry Pi) performs safe, deterministic greeting-filler trimming without ever stripping age or non-stickered attributes.
3. **User-Controlled Comparison & Embedding Refresh:**
   - `AiSuggestionModal` defaults to **Keep original text**, offers a one-tap toggle to **Use streamlined text** with an inline editable textarea and live `WishCard` preview (showing stickers + text + overflow detection), and displays a gentle reminder if a sticker-backed creator tag is deselected while streamlined text is active.
   - Accepting updated card text via `POST /api/wishes/:id/suggestions/:action` (`content?: string`) updates `wishes.content` and refreshes `wish_embeddings` asynchronously **without** queueing a recursive tagging suggestion loop.

## Architectural Boundary (`wishboard` vs. `@wishboards/matching-engine`)

- **`@wishboards/matching-engine`** remains pure, zero-dependency, and AI-free. `AiSuggestionModal` reuses its exported `getExclusionConflicts` and `hasToken` functions directly in the browser bundle so client pre-validation and server enforcement are guaranteed to agree 100%.
- **`wishboard`** owns all AI provider adapters, sticker-aware prompt construction, `wish_ai_suggestions` storage, HTTP/OpenAPI contracts, and multi-device review UI.

## Alternatives Considered

- **Auto-updating Account Profile on every accepted suggestion:** Rejected because convention attendees frequently post situational wishes (e.g., exploring a role for one event night) and silent profile drift would affect unrelated wishes and searches.
- **Selecting desired attributes by default:** Rejected because explicit `desired_attributes` disable implicit acceptance/cross-match rules in `@wishboards/matching-engine`, silently narrowing matches.
- **Calling `POST /api/rules/check-conflicts` on every chip tap:** Rejected in favor of synchronous client-side evaluation via `@wishboards/matching-engine` using live rules from `/api/config`, giving zero-latency feedback and full offline resilience on convention Wi-Fi.
- **Aggressive LLM summarization of wish text:** Rejected because summarizing away unstructured details (like age) or non-stickered attributes (like role) causes information loss on the physical/digital card and strips attendee personality.

## Consequences

- **Pros:**
  - Attendees retain full visibility and control over wish vs. profile scope, matching restrictiveness, and card wording.
  - Zero-latency conflict resolution eliminates failed submissions across mobile, tablet/kiosk, and desktop devices.
  - Card text stays concise and readable without losing important non-stickered context.
  - Backward-compatible API and DB schema (`ensureColumn`, optional request fields) preserve zero-downtime upgrades on both Raspberry Pi and AWS Serverless.
- **Cons:**
  - Increases client bundle marginally by importing `@wishboards/matching-engine` (~4 KB gzipped).
  - Prompt instructions for `CloudInferenceProvider` must remain tightly tested against regression cases (e.g., preserving age and non-stickered terms).

## Tracking

- **Epic:** [#644](https://github.com/wishboards/wishboard/issues/644)
- **Phase 1 (Interactive Chips, Desired Guardrails, Client Conflict Resolution & Responsive Modal):** [#641](https://github.com/wishboards/wishboard/issues/641)
- **Phase 2 (Signed-In Scope Control & Profile Conflict Detection):** [#642](https://github.com/wishboards/wishboard/issues/642)
- **Phase 3 (Sticker-Aware Streamlining, Storybook, E2E & Documentation):** [#643](https://github.com/wishboards/wishboard/issues/643)

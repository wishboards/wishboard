---
title: 0011 Theming Skinning and Mobile Companion UX
---

# ADR 0011: Dual-Persona Skinning Architecture, Tactile Card Styling, and Mobile Companion UX

- **Status:** Proposed
- **Context date:** October 2026
- **Companion Design Document:** [Design 0003: Skinning Architecture, Tactile Card Personalization, & Mobile Companion UX](../../design/0003-skinning-and-mobile-companion-ux)

## Context

Wishboard operates as a dual-surface application across two deployment targets (disconnected Raspberry Pi Kiosk and AWS Serverless):

1. **Public Display Surface (`DisplayPage`, `PosterPage`):** A large-screen ambient digital corkboard and printable QR poster viewed from a distance at events.
2. **Handheld Companion Surface (`HomePage`, `EnterWishPage`, `SearchPage`, `WishmailPage`, `AccountPage`):** A mobile web application accessed on attendees' phones via QR scan or captive portal.

Three architectural and user-experience gaps currently exist:

1. **Visual Discrepancy & Broken Token Cascade:** The product site (`wishboards.app`) uses a modern dark glassmorphic and warm-amber palette ("Midnight Lounge"), while `wishboard`'s handheld views use flat light-gray backgrounds (`#f1f3f5`) and over 30 hardcoded hex values (`#1a73e8`, `#f8fafc`, `#d7dee5`) in `src/client/src/styles.css` that bypass `theme.css`.
2. **Two Distinct Skinning & Personalization Personas:**
   - **Event Hosts ("System Users"):** Event organizers need to brand their Wishboard instance with organization logos, brand colors, custom board/background graphics, and event copy across both the Kiosk Display and Handheld Companion app—including in offline Raspberry Pi AP environments where external image URLs are unreachable.
   - **Attendees ("End Users"):** In physical Wishboard installations, attendees choose colored 3×5 index cards and pushpins. Digitally, all wishes currently render identically, and user-level appearance preferences do not persist with the user's account across devices.
3. **Handheld Scroll Fatigue & Navigation Redundancy:** On mobile viewports (`< 768px`), `HomePage` duplicates `MobileBottomBar` navigation (11 navigation targets visible simultaneously), while `EnterWishPage`, `SearchPage`, and `AccountPage` render all identity attribute pills and secondary workflows inline (~2,200px vertical height).

## Decision

We will adopt **Option 4 (Full Integrated Architecture via 4-Phase Rollout)** using **Runtime Profile + DB Host Skinning with Dual-Target Asset Storage (Approaches 1B + 2B)**, **Account-Persisted User Preferences + Tactile Per-Wish Card Styling**, and **Progressive-Disclosure Bottom Sheets (Approach 3A)**.

### 1. Three-Tier Semantic CSS Token Engine (`--wb-*`)

All hardcoded color, surface, border, and shadow values in `src/client/src/styles.css` and inline React styles will be replaced with semantic `--wb-*` CSS custom properties resolved in three layers:

1. **Tier 1 — Base Theme Defaults (`src/client/src/styles.css`):** Ships the `wishboards.app` **"Midnight Lounge"** dark glassmorphic palette (`--wb-bg-base: #080d1a`, `--wb-bg-surface: rgba(30, 41, 59, 0.78)`, `--wb-accent-primary: #f59e0b`, `Outfit` + `Inter` typography) alongside built-in `[data-theme="daylight"]`, `[data-theme="corkhouse"]`, and `[data-theme="high-contrast"]` presets.
2. **Tier 2 — Event Host / Organization Skin (`GET /api/config` & `PUT /api/admin/branding`):**
   - Seeded from `profiles/<name>/profile.yaml` (`branding` block) and overridable at runtime by Event Hosts via a `settings` table in SQLite/libSQL (`src/server/db.js`).
   - Supports organization `logoUrl`, `boardBackgroundUrl`, `boardTexture` (`cork`, `slate`, `linen`, `custom`), `presetSkin`, and brand color overrides (`primaryColor`, `accentColor`, `surfaceColor`).
   - Custom uploaded host logos and board background graphics reuse Wishboard's existing dual-target image storage pipeline (`data/images/` on Raspberry Pi; `AWS_S3_BUCKET` on AWS Serverless) so branding works seamlessly in completely offline Pi Kiosk deployments.
3. **Tier 3 — Attendee Account Preferences (`users.ui_preferences`):**
   - Stored in a `ui_preferences` JSON column on the `users` table (`await ensureColumn('users', 'ui_preferences', 'TEXT')`) and returned on `/api/users/login`, `/api/users/register`, and `/api/users/me`, with updates persisted via `PUT /api/users/me`.
   - Schema: `{ themeMode?: 'host-default' | 'midnight' | 'daylight' | 'high-contrast', defaultCardColor?: CardColorId, defaultPinColor?: PinColorId }`.
   - Unauthenticated guests fall back to `globalThis.localStorage` (`wishboard_ui_preferences`), which automatically syncs into `users.ui_preferences` upon registration or login.

### 2. Tactile Per-Wish Card & Pushpin Personalization (`wishes.card_style`)

To bridge physical 3×5 index cards and typed digital wishes without cluttering the mobile form:

- **Database Storage:** Add a `card_style` JSON column to `wishes` (`await ensureColumn('wishes', 'card_style', 'TEXT')`) storing `{ paperColor: 'ivory' | 'canary' | 'rose' | 'sky' | 'sage', pinColor: 'ruby' | 'amber' | 'emerald' | 'sapphire' | 'violet' }`.
- **Zero-Clutter Composer Interaction:** On `EnterWishPage`, the live 3×5 card preview acts as an interactive header:
  - Tapping the rendered 3D pushpin cycles through the 5 pushpin colors.
  - Five compact paper-tint dots (`20×20px` touch-padded swatches) sit in the bottom-right corner of the card preview itself—adding zero vertical height to the page.
  - Defaults automatically to the user's saved `defaultCardColor` / `defaultPinColor` from `users.ui_preferences`.
- **Board Rendering:** `WishCard` on `DisplayPage` and `SearchPage` renders the chosen paper tint (with guaranteed WCAG AA dark ink contrast `#1e293b` on pastel card papers) and 3D pushpin color.

### 3. Mobile Companion UX ("Controller vs. Canvas" — Approach 3A)

For handheld viewports (`< 768px`):

1. **4-Tab Thumb-Zone Navigation (`MobileBottomBar`):** Consolidate to `Home`, `Post` (primary amber pill), `Search`, `Inbox` (with unread badge), and `Account`. Remove `Big Screen Display` and `Admin` from the primary phone bar (accessible via footer/Account overflow).
2. **Single-Viewport Companion Home (`HomePage.tsx`):** Replace the 5 stacked blue buttons with the Event Host's branded header/logo, 2 primary hero cards (_Post a Wish_ and _Find Matching Wishes_), and a compact session status pill.
3. **Progressive-Disclosure Bottom Sheets (`EnterWishPage.tsx` & `SearchPage.tsx`):**
   - Collapse inline `AttributeInput` pill walls into compact summary trigger rows (_"About Me: 2 selected"_, _"Match Criteria: Any"_, _"Contacts & Wishmail"_, _"Scan Physical Card"_).
   - Tapping a trigger opens a reusable `<BottomSheet>` drawer with a sticky `Done` bar.
   - On `SearchPage`, replace the inline guest attribute form with a sticky top search bar and a single-line `Filter Profile` chip so search results appear immediately above the fold.
4. **Segmented Account Views (`AccountPage.tsx`):** Split the 5 stacked sections into 3 horizontal pill tabs (`My Wishes` | `Identity & Match` | `Appearance & Security`).

---

## 4-Phase Separable Implementation Plan

Each phase is independently valuable, testable, and deployable without blocking subsequent phases:

| Phase                                                                  | Scope                                                                                                                                                                                                                           | Key Files Touched                                                                                      | Complexity     | Target PRs |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------- | :------------- | :--------- |
| **Phase 1: Visual Foundation, CSS Token Engine & Account Preferences** | Refactor `styles.css` to `--wb-*` tokens; port `wishboards.app` Midnight Lounge theme; add `branding` schema to `profile.yaml` & `GET /api/config` (`1B`); add `users.ui_preferences` column & `PUT /api/users/me` persistence. | `styles.css`, `theme.css`, `EventProfileContext.tsx`, `db.js`, `users.js`, `openapi.js`                | **Low**        | 1–2 PRs    |
| **Phase 2: Tactile 3×5 Card & Pushpin Personalization**                | Add `wishes.card_style` column; add zero-clutter inline paper & pushpin color swatches to `WishPreview` on `EnterWishPage`; render paper tints & pin colors on `WishCard` (`DisplayPage` + `SearchPage`).                       | `db.js`, `wishes.js`, `EnterWishPage.tsx`, `WishCard.tsx`, `openapi.js`                                | **Low–Medium** | 1 PR       |
| **Phase 3: Mobile Companion UX & Scroll Elimination (`Approach 3A`)**  | Redesign `HomePage` hub & 4-tab `MobileBottomBar`; build reusable `<BottomSheet>` component; convert `EnterWishPage` & `SearchPage` attribute walls to bottom sheets; add segmented tabs to `AccountPage`.                      | `App.tsx`, `HomePage.tsx`, `EnterWishPage.tsx`, `SearchPage.tsx`, `AccountPage.tsx`, `BottomSheet.tsx` | **Medium**     | 2 PRs      |
| **Phase 4: Live Event-Host Skinning Studio (`Approach 2B`)**           | Add `settings` table in `db.js`; add `PUT /api/admin/branding` + logo/background upload (`data/images` on Pi, S3 on Serverless) + WebSocket live-reload; add **Branding & Skin** tab in `AdminPage`.                            | `db.js`, `admin.js`, `AdminPage.tsx`, `DisplayPage.tsx`, `PosterPage.tsx`, `openapi.js`                | **Medium**     | 1–2 PRs    |

## Alternatives Considered

- **Option 0: Null Hypothesis (Status Quo):** Rejected due to sharp aesthetic drop-off from `wishboards.app`, broken CSS token cascade, lack of event host branding, and severe mobile vertical scrolling.
- **Option 1: Static File-Based Profile Branding Only:** Leaves event hosts needing filesystem/CLI access to configure logos and colors, and omits attendee card personalization.
- **Option 3B: Mandatory 2-Step Card Composer Wizard:** Rejected in favor of Approach 3A because it adds an unnecessary `Next` tap barrier for registered users whose identity attributes are already set.

## Consequences

- **Pros:**
  - Unified brand experience with `wishboards.app`.
  - True dual-persona customization (Event Host macro branding + Attendee micro tactile card and pushpin styling).
  - Offline Pi + AWS Serverless feature parity using established image storage patterns.
  - 65–70% reduction in mobile scroll depth on primary creation and discovery flows.
- **Cons:**
  - Requires updating mobile E2E test selectors in Phase 3 for attribute triggers.
  - Schema additions for `users.ui_preferences`, `wishes.card_style`, and `settings` table.

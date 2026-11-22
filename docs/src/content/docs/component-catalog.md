---
title: UI Component Catalog (Storybook)
---

Wishboard includes a standalone component catalog built with [Storybook](https://storybook.js.org/) to develop, document, and test UI components in isolation (implementing **ADR 0008 Phase 3**).

:::tip[Live Component Catalog]
Browse the published interactive catalog directly at [`/storybook/`](../storybook/) — built automatically alongside this documentation site on every push to `main`.
:::

The catalog integrates `@storybook/addon-a11y` for automated accessibility audits (axe-core) and provides interactive toolbar controls to preview components across all **4 built-in theme presets** and **5 tactile paper tints**.

---

## Interactive Controls

The Storybook toolbar provides instant global switching for:

### 1. Theme Presets (ADR 0011 / Design 0003)

- **Midnight Lounge (Dark)**: Deep navy canvas (`#080d1a`), slate glass surfaces, warm amber accents (`#f59e0b`).
- **Daylight (Light)**: Crisp warm light palette (`#f8fafc`), clean white surfaces, deep blue accents (`#2563eb`).
- **Corkhouse (Warm)**: Warm wood and corkboard tones (`#2b1f14`), deep amber highlights (`#d97706`).
- **High Contrast (WCAG AAA)**: True black canvas (`#000000`), high-contrast yellow borders & accents (`#ffff00`), meeting strict $\ge 7:1$ contrast requirements.

### 2. Tactile 3x5 Card Paper Tints (Design 0003 Section 3.1)

- **Ivory** (`#fdfbf7`): Classic cream index card.
- **Canary** (`#fef9c3`): Pale yellow convention index card.
- **Rose** (`#ffe4e6`): Soft pastel rose card.
- **Sky** (`#e0f2fe`): Crisp light sky blue card.
- **Sage** (`#dcfce7`): Minty pale sage card.

### 3. Tactile Pushpins

- **Ruby** (`#ef4444`)
- **Amber** (`#f59e0b`)
- **Emerald** (`#10b981`)
- **Sapphire** (`#3b82f6`)
- **Violet** (`#8b5cf6`)

---

## Documented Components

The component catalog covers the following core UI components:

1. **`WishCard`**: The core tactile 3x5 index card featuring pushpin interaction, custom paper swatches, identity stickers, contacts, and photo attachments.
2. **`IdentityStickers`**: SVG and emoji sticker rendering by identity categories (orientation, gender, roles, interests).
3. **`FlagButton`**: Interactive flag report button with accessible ARIA labeling.
4. **`InfoToggle`**: Accessible toggleable info disclosure widget.
5. **`PassphraseInput`**: Passphrase field with toggleable visibility and copy support.
6. **`WiFiQrCode`**: QR code connection widget (supporting floating and sidebar variants for kiosk mode).
7. **`BottomSheet`**: Mobile companion drawer with gesture-based swipe-to-dismiss and focus trapping.
8. **`MobileBottomBar`**: Thumb-zone bottom navigation bar with unread wishmail badges.
9. **`AttributeInput`**: Accessible tag selector with suggestions and input validation.
10. **`WishPreview`**: Live wish card creator preview with real-time pushpin color cycling.
11. **`AiSuggestionBadge`**: Interactive pending-suggestions indicator that opens the human-in-the-loop AI review modal on wish cards.

---

## Running Storybook Locally

To launch the local Storybook development server:

```bash
npm run storybook
```

This starts the Storybook sandbox at `http://localhost:6006`.

## Building the Static Catalog

To build the static catalog bundle:

```bash
npm run build:storybook
```

This outputs static assets into `storybook-static/`, which is merged into the GitHub Pages deployment under [`/storybook/`](../storybook/).

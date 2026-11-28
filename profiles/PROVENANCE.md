# Profile Taxonomy & Asset Provenance

This document records the license-vetted external reference catalogs and asset sources used to curate Wishboard's `profiles/lifestyle/` taxonomy, matchmaking rules, and sticker assets, as well as sources that are **strictly excluded** for license-compatibility reasons.

The machine-readable counterpart to this file is [`profiles/provenance.json`](./provenance.json), which is enforced by `scripts/analyze-taxonomy.js`.

## License Policy

- **Allowed licenses:** `Apache-2.0`, `MIT`, `CC0-1.0`
- **Excluded licenses:** `AGPL-3.0-or-later`, `CC BY-NC-SA 4.0`

Any third-party seed catalog or asset bundle with an excluded or unrecognized license is rejected by the static profile analyzer CLI.

## Approved Sources

| Source                      | License      | Scope                                                 | Notes                                                                                                                        |
| --------------------------- | ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `fetlife/translations`      | `Apache-2.0` | `gender`, `orientation`, `role`, `relationship_style` | Roles, genders, orientations, and relationship-status labels only. Do **not** import FetLife trademarks, logos, or branding. |
| `Goctionni/kinklist-v2`     | `MIT`        | `role`, `interests`                                   | BDSM/kink practices, dynamics, and categories.                                                                               |
| `Yellow-Dog-Man/PrideFlags` | `CC0-1.0`    | `stickers`                                            | LGBTQIA+ pride flag assets.                                                                                                  |
| `@prideraiser/flags`        | `MIT`        | `stickers`                                            | Pride flag SVG geometry and color palettes.                                                                                  |

## Strictly Excluded Sources

| Source                      | License             | Reason for Exclusion                                                                                                                            |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContribuLibre/check-match` | `AGPL-3.0-or-later` | Strong copyleft (`AGPL-3.0-or-later`) is incompatible with Wishboard's distribution and deployment model.                                       |
| `microsoft/Pride-flag`      | `CC BY-NC-SA 4.0`   | NonCommercial and ShareAlike clauses (`CC BY-NC-SA 4.0`) are incompatible with convention/commercial deployments and ShareAlike redistribution. |

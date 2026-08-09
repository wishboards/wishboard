# ADR 0005: Matching Engine Generalization and Context-Aware Rules

- **Status:** Implemented
- **Date:** 2026-07
- **Context Date:** 2026-07

## Context

Wishboard's matching engine relies on matching rules defined in the database `rules` table (see [ADR 0002](0002-serverless-database-architecture.md) and [#188](https://github.com/wishboards/wishboard/issues/188)), which are seeded by default from the active event profile's `profile.yaml` (e.g., [profiles/lifestyle/profile.yaml](../../profiles/lifestyle/profile.yaml)). These rules govern how attribute categories such as `gender`, `orientation`, and `role` are matched bidirectionally between a wish creator and a searcher.

In the completed work for [#206](https://github.com/wishboards/wishboard/issues/206) (see PR [#233](https://github.com/wishboards/wishboard/pull/233)), we expanded the default taxonomy for power-exchange, activity, pet-play, and rope roles. However, during that implementation, context-gated rules were deferred due to a structural limitation:

Currently, rule evaluation is only context-aware (checking `context_attribute` and `context_value` via `evaluateRuleConditions`) for `enrichment` and `acceptance` rule types. The matching engine's expansion and cross-match helpers — [getExpandedDesired](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L84-L102) and [getCrossMatchedDesired](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L203-L224) — only accept a flat list of desired values and the category, ignoring the rules' `context_attribute` and `context_value` entirely.

This limitation prevents us from implementing rules like: _"expand `top` to include `vers` only when the searcher's orientation is `gay`"_. This prevents unintended cross-community matching between BDSM top/bottom vocabularies and queer sexual top/bottom/vers vocabularies without resorting to ad-hoc, hardcoded checks.

## Decision & Proposed Design

To resolve this limitation without introducing custom parsing helpers to [wishes.js](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js), we will generalize the matching engine to support context-gated `expansion` and `cross_match` rules.

### 1. Context-Aware Helpers

We will update [getExpandedDesired](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L84-L102) and [getCrossMatchedDesired](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L203-L224) to accept an optional `contextProfile` (the searcher's full attribute map: `{ gender, orientation, role }`).

When filtering and applying `expansion` and `cross_match` rules, the engine will check if the rule defines a `context_attribute` and `context_value`. If it does, the rule will only apply if the `contextProfile` matches those conditions.

```javascript
const matchesContext = (rule, contextProfile, rules = []) => {
  if (!rule.context_attribute || !rule.context_value) return true;
  if (!contextProfile) return false;

  const ctxVals = contextProfile[rule.context_attribute] || [];
  // Evaluate the context using a recursive expansion, passing null as the
  // contextProfile to prevent infinite loops on recursive context expansion.
  const expandedCtxVals = getExpandedDesired(ctxVals, rule.context_attribute, rules, null);
  return expandedCtxVals.some((v) => hasToken(v, rule.context_value));
};
```

### 2. Matching Engine Pipeline Updates

We will propagate the `searcherProfile` through [matchesAttribute](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L226-L242) and all call sites in [isCompatible](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L261-L327):

- For checking if the searcher matches the wish's desired attributes, the context profile is the `searcherProfile`.
- For checking if the wish creator matches the searcher's desired attributes (where the wish creator is the "searcher" of this sub-match), the context profile is the `creatorProfile`.
- Update [getExclusionConflicts](file:///c:/Users/pltho/wishboard/src/server/routes/wishes.js#L104-L158) to pass the written profile as the context during write-time validation, allowing context-gated expansions to be validated.

---

## Thought Experiments

### 1. Adding a 4th Attribute Category (e.g., Activity, Kink-Style)

The rule engine and the `rules` database table schema are already fully generic (they support any arbitrary string in `trigger_attribute` and `target_attribute`).

Before the full implementation of this ADR, adding a new 4th attribute category to Wishboard (e.g., `activity`) would have required updates across the database, business logic, and UI boundaries. However, as noted in the Implementation Notes below, the codebase was fully refactored to eliminate hardcoded schemas.

Currently, adding a new category is almost entirely configuration-driven:

- **Domain Configuration**: Simply add the new category to the active domain configuration file (e.g., `defaultDomain.yaml`). The frontend will automatically read this and dynamically render inputs, pills, and suggestions for it.
- **Database Schema**: No changes needed! The `users` and `wishes` tables now use a single unified JSON `attributes` blob that can store arbitrary keyed category arrays.
- **Matching Business Logic**: The matching engine natively maps over the unified `attributes` JSON, automatically validating and filtering across all defined categories.

**Conclusion:** Thanks to the unified Domain Configuration Layer and JSON `attributes` migration, adding new attribute categories requires zero code or schema changes—it is managed entirely via configuration.

### 2. Multi-Domain Deployment Configuration

Currently, Wishboard is deployed with a hardcoded assumption of BDSM/queer identities in the UI labels, static suggestion lists (such as `SUGGESTED_ROLES` or `SUGGESTED_GENDERS`), and the database seeds. Deploying it for a professional conference or educational setting would require forking the frontend codebase.

To support clean multi-domain deployments without code forks, we propose introducing a **Domain Configuration Layer**:

- **Unified Schema**: Define a domain configuration schema (e.g., `domain.config.yaml` or a DB table) specifying available attribute categories, their display labels, autocomplete suggestion lists, and the default matching rule seeds.
- **API Delivery**: The server will serve this configuration via `GET /api/config`.
- **Dynamic Frontend**: The React client will read the configuration at startup and dynamically render fields, suggestions, labels, and pill colors rather than relying on hardcoded lists.
- **Dynamic Seeding**: The database will seed matching rules dynamically based on the rule seeds declared in the active domain configuration.

---

## Alternatives Considered

- **Special-casing within wishes.js**: We could hardcode an orientation check specifically for the `role` match logic (e.g., if orientation is `gay`, behave differently). This was rejected because it breaks the configuration-driven matching model, scatters matching rules across the code, and makes rules un-editable via the admin UI.
- **Recursive DB CTEs (Common Table Expressions)**: We could perform matching rule expansions directly in the database. This was rejected because we cache rules in memory to maintain synchronous performance for the matching engine, which is critical in serverless Lambda environments where DB calls are relatively expensive.

---

## Consequences

- **Pros**:
  - Eliminates unintended cross-community matches by allowing context-gated expansion/cross-match rules.
  - Keeps all matching logic centralized in the configuration-driven rule system.
  - Enables fine-grained community boundaries while keeping UI administration simple.
- **Cons**:
  - Slightly increases complexity of matching engine function signatures by threading the context profile.
  - Requires care to prevent infinite loops in recursive expansions (mitigated by passing `null` for the nested context profile).

---

## Implementation Notes

During the implementation of this ADR, we went beyond fixing the context-gated expansions. We completely eliminated hardcoded `gender`, `orientation`, and `role` references across both the frontend and backend.

- **Frontend:** Adopted a `DomainContext` system, where attribute inputs are dynamically generated from a configuration YAML file (e.g., `defaultDomain.yaml`).
- **Backend/API:** Refactored the `/api/wishes` endpoint to accept a unified `attributes` JSON payload, falling back to legacy query parameters only when necessary.
- **Infrastructure:** Updated the AWS serverless template and `wishboard` CLI to support deploying parallel stacks to multiple domains, utilizing wildcard certificates (primary `wishboards.app`, SAN `*.wishboards.app`) and isolated Turso databases to support alternate community implementations (like a conference setup vs. the default demo).

---
title: Matching Rules
---

# Wishboard Matching Engine Rules

The Wishboard matching engine is designed to be inclusive, flexible, and
powerful. It leverages five types of rules to create connections between users
based on their profile attributes (such as gender, orientation, role, or professional goals)
and their desired matches.

## Where rules live and how to edit them

At runtime, matching rules live in a **`rules` table in the database** — Turso on the
serverless target, the embedded libSQL container on the Pi, or local SQLite for development.
This ensures they persist across restarts and cold starts and are shared across all Lambda instances.
Administrators can create, edit, and delete rules live through the **admin Rules page**;
changes propagate to the in-memory matching cache within a short cache TTL
(`RULES_CACHE_TTL_MS`, default 60s) without requiring a server restart or redeploy.

Default rules are bundled with each event profile (e.g. in `profiles/<profile>/rules.yaml`
or inline within `profiles/<profile>/profile.yaml` — see [Event Profiles](event-profiles.md)).
On first boot, if the database `rules` table is empty, the application automatically seeds it
from the active profile's default rules. After initial seeding, the database is the authoritative
source of truth.

Identity attributes are completely dynamic and defined by the active event profile's
`categories` schema (see [ADR 0005](adr/0005-matching-engine-generalization.md) and
[Event Profiles](event-profiles.md)). Attributes are stored in unified `attributes`
JSON structures on users and wishes rather than hardcoded database columns. For instance,
while the default `lifestyle` profile configures `gender`, `orientation`, and `role`, the
`professional` profile configures networking goals (`Hiring`, `Job Seeking`, `Mentoring`),
and rules can evaluate any attribute defined by the profile.

## 1. Enrichment (Implicit Attribute Mapping)

**Purpose**: To implicitly add an attribute to a user's profile based on the
presence of another attribute.

If a user identifies with a certain combination of traits, they implicitly
possess another trait in the context of matching.

**Format**:

- `trigger_attribute` & `trigger_value`: The primary trait the user has.
- `context_attribute` & `context_value` (Optional): A secondary trait the user
  must also have.
- `target_attribute` & `target_value`: The new trait implicitly added to the
  user's profile.

**Example**:

A user who is a "woman" (context) and identifies as "gay" (trigger) is
implicitly enriched with the "lesbian" (target) orientation. This ensures they
match with people seeking lesbians.

---

## 2. Acceptance (Blanket Override)

**Purpose**: To allow a specific identity to automatically accept a broad range
of target identities, overriding strict one-to-one matching.

When a user searches for a specific trait, or a wish desires a specific trait,
an acceptance rule forces the matching engine to accept a list of other traits
as compatible.

**Format**:

- `trigger_attribute` & `trigger_value`: The trait the searcher/wisher
  possesses or is looking for.
- `target_attribute` & `target_value`: A comma-separated list of traits that
  are automatically accepted.

**Example**:

If a user's orientation is "pan" (pansexual), an acceptance rule automatically
targets the gender attribute and accepts `"man, woman, nonbinary, cis-man,
cis-woman, trans-man, trans-woman, men, women"`. The matching engine will treat
the user as compatible with any of these genders.

---

## 3. Expansion (Inclusive Expansion)

**Purpose**: To broaden a specific search term or requirement to include
related terms or sub-categories.

This prevents users from having to list every possible synonym or sub-category
when creating a wish or searching.

**Format**:

- `trigger_attribute` & `trigger_value`: The broad term being searched for or
  desired.
- `target_attribute` & `target_value`: A comma-separated list of more specific
  terms that should also trigger a match. (Note: `trigger_attribute` and
  `target_attribute` are always the same).

**Example**:

If a wish desires a "pet", an expansion rule will automatically expand that
requirement to also match with users identifying as a "pup" or "kitten".

_(Note: Expansion rules can optionally be evaluated with context to prevent unintended matches. This context-gated evaluation was implemented in [ADR 0005](adr/0005-matching-engine-generalization.md).)_

---

## 4. Cross-Match (Complementary Roles)

**Purpose**: To create bidirectional, complementary connections between different
roles or identities.

This is crucial for role-based matching where a user identifying as Role A is
inherently seeking Role B, and vice-versa.

**Format**:

- `trigger_attribute` & `trigger_value`: The first role (e.g., "handler").
- `target_attribute` & `target_value`: The complementary role (e.g., "pet").

**Example**:

A cross-match rule between "handler" and "pet" means:

1. If a wish desires a "handler", a user identifying as a "pet" will match.
2. If a wish desires a "pet", a user identifying as a "handler" will match.

Combined with an **Expansion** rule (e.g., "pet" expands to "pup, kitten"), a
"handler" will automatically match with a "pup" or "kitten" without needing
explicit rules for every combination!

_(Note: Cross-match rules can optionally be evaluated with context to prevent unintended cross-community matching. This context-gated evaluation was implemented in [ADR 0005](adr/0005-matching-engine-generalization.md).)_

> In the default `lifestyle` profile, bundled defaults seed role relationships and their respective expansions:
>
> - **Pet / Handler**: `handler ↔ pet` (with `pet` expanding to `pup, puppy, kitten, kitty, pony`)
> - **Top / Bottom**: `top ↔ bottom` (along with `switch ↔ top` and `switch ↔ bottom`)
> - **Dominant / Submissive**: `dominant ↔ submissive` (with `submissive` and `sub` expanding to `submissive, sub, slave, service-sub, little`; `dominant`, `dom`, and `domme` expanding to `dominant, dom, domme, master, mistress`)
> - **Master / Slave**: `master ↔ slave`
> - **Owner / Property**: `owner ↔ property`
> - **Rigger / Rope-bunny**: `rigger ↔ rope-bunny` (rope bondage)
> - **Sadist / Masochist**: `sadist ↔ masochist`
> - **Caregiver / Little**: `caregiver ↔ little` (with `caregiver` expanding to `caregiver, daddy, mommy, mummy`)
> - **Brat-tamer / Brat**: `brat-tamer ↔ brat`
> - **Versatile / Vers**: `vers ↔ versatile` (synonyms)
>
> In the `professional` profile, bundled cross-match rules connect complementary networking goals:
>
> - **Hiring / Job Seeking**: `Hiring ↔ Job Seeking`
> - **Mentoring**: `Mentoring ↔ Seeking Mentor`

---

## 5. Exclusion (Write-time Contradiction Prevention)

**Purpose**: To detect and block contradictory attribute combinations at the
point of wish or profile submission, keeping stored data logically consistent.

Unlike the other rule types which operate at _search time_ to produce match
results, `exclusion` rules run _before_ data is written to the database. If
the submitted attributes violate an exclusion rule, the API returns a `400`
error and the submission is rejected. The frontend also evaluates conflicts
live (via `POST /api/rules/check-conflicts`) and shows inline warnings before
the user can submit.

**Applies to**: `POST /api/wishes`, `POST /api/users/register`, `PUT /api/users/me`.

**Format**:

- `trigger_attribute` & `trigger_value`: The first (triggering) attribute value.
- `context_attribute` & `context_value` (Optional): An additional condition that
  must also be present for the conflict to fire (e.g. "only flag `lesbian` as
  conflicting if the person also identifies as `man`").
- `target_attribute` & `target_value`: The second attribute value that is
  incompatible with the trigger.

Both directions are checked symmetrically — if `gay` conflicts with `straight`,
the rule fires whether the user lists them as `gay, straight` or `straight, gay`.
Expansion rules are applied first, so synonyms (e.g. `enby` → `nonbinary`) are
resolved before the conflict check runs.

**Example**:

An exclusion rule with `trigger = orientation:gay` and `target = orientation:straight`
blocks a user from registering with both orientations at the same time. A
context-scoped rule with `trigger = orientation:lesbian`, `context = gender:man`,
`target = gender:man` blocks a user who identifies as both a man and lesbian,
since that is a biological contradiction for most users.

**Seeded defaults** (editable via the admin Rules page):

| Rule ID             | Trigger                | Context       | Target                  | Meaning                                                              |
| :------------------ | :--------------------- | :------------ | :---------------------- | :------------------------------------------------------------------- |
| `excl_gay_straight` | `orientation: gay`     | —             | `orientation: straight` | Gay and straight are mutually exclusive orientations                 |
| `excl_lesbian_man`  | `orientation: lesbian` | `gender: man` | `gender: man`           | Identifies as both lesbian and man (contradictory for most contexts) |

> Additional `exclusion` rules can be added and removed at runtime via the admin UI
> without restarting the server. The live rule set is evaluated within the same
> in-process cache TTL (`RULES_CACHE_TTL_MS`, default 60 s) as all other rule types.

---

## 6. Application of Rules in Search

The matching rules outlined above are applied within the Wishboard application as follows:

- **Profile Defaults**: By default, the search engine filters wishes based on the currently logged-in user's profile attributes (gender, orientation, role).
- **Explicit Match Overrides**: If a wish creator specifies a explicit desired trait (e.g. they only want a specific gender), that explicit requirement strictly overrides any implicit rules.
- **Implicit Rules**: If a wish creator leaves desired traits blank, the matching engine relies on the creator's orientation to determine compatibility (e.g., a straight user implicitly matches only with binary opposite genders).
- **Broad Search**: Logged-in users can temporarily disable profile-based matching in the UI to perform broad, unrestricted keyword searches.
- **Anonymous Search**: Users who are not logged in can provide temporary gender, orientation, and role values in the search UI to perform a one-off compatibility query.

## 7. Matching is bidirectional (and a few deliberate edge cases)

A wish and a searcher match only when **both** directions agree: the searcher
must want the wish creator **and** the creator must want the searcher. The
following semantics are deliberate (pinned by the regression matrix in
`src/server/routes/matching.regression.test.js`):

- **Unspecified preference does not mean "wants everyone".** If a party has no
  explicit desired gender **and** no orientation to infer one from, there is no
  established preference, so it does **not** match. (This was an over-match:
  a woman's wish with neither set was shown to a straight man — see
  [#199](https://github.com/wishboards/wishboard/issues/199).) To be matched
  implicitly, set an orientation or an explicit desired gender; or use Broad
  Search for unfiltered results.
- **Bisexual vs. pansexual.** By design, **bisexual** matches binary genders
  (man/woman and their trans/cis forms), while **pansexual/queer** is
  gender-blind and also matches nonbinary people. A bisexual person who wants a
  nonbinary match can set an explicit desired gender.
- **Trans inclusion.** A trans woman is matched as a woman and a trans man as a
  man (via gender expansion), so e.g. a straight man and a straight trans woman
  match. This is intentional and inclusive; a searcher who wants to filter such
  results can hide individual wishes.
- **Nonbinary + a binary orientation.** Orientations like straight/gay/lesbian
  are defined against man/woman, so a nonbinary person with one of them has no
  gender preference the engine can infer and matches nobody implicitly — set an
  explicit desired gender or use Broad Search.

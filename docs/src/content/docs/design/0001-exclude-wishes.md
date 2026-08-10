---\ntitle: 0001 Exclude Wishes\n---\n# Design 0200: Let a user exclude ("not interested" / hide) a wish

- **Status:** Implemented. Tracks [#200](https://github.com/wishboards/wishboard/issues/200).
- **Date:** 2026-07
- **Related:** [ADR 0002 (database architecture)](../adr/0002-serverless-database-architecture.md), [Matching Rules](../MATCHING_RULES.md)

## Context

A wish that a user has already seen and doesn't care about isn't the same as an
_abusive_ wish. Today the only "make it go away" action on a wish is **flag**
(`POST /api/wishes/:id/flag`), which sets `wishes.flagged = 1`, notifies admins
over WebSocket, and is meant for reporting. The client's `useFlagWish` hook does
remove the card from the current result set, but that removal is **ephemeral** —
it lives only in React state and comes back on the next search, and flagging
also (mis)reports the wish to moderators.

We want a second, personal action — **exclude** (a.k.a. "not interested" /
"hide") — that:

- removes a wish from **that one user's** future search results, durably;
- is **not** a report — no admin signal, no `flagged` bit;
- is **reversible** (the user can see and un-hide what they've hidden);
- works even for a not-logged-in visitor, but **scoped strictly to that
  visitor** — one anonymous user's exclusions must never leak into anyone
  else's board.

The hard part is the last point. A logged-in user has a durable key
(`users.id`) we can store exclusions against; an anonymous visitor has none.

### How the pieces work today (grounding)

- **Identity.** `getUserFromToken` (`src/server/auth.js`) resolves a
  `Bearer` token from the `Authorization` header against the `sessions` table.
  **Logged-in ⇔ a valid token resolves to a user**; **anonymous ⇔ no token**.
  In `src/server/routes/wishes.js`, `getRequestUser(req)` wraps this, so the
  same request handler already knows whether it has a user or not.
- **The wish model.** `wishes` (`src/server/db.js`) has a nullable `user_id`
  (null for anonymously-created wishes, which instead carry a `secret_hash`),
  plus `is_active` and `flagged` flags. Deleting a wish via
  `POST /api/wishes/:id/manage` with `action: 'delete'` is a **hard**
  `DELETE FROM wishes`; `POST /api/wishes/:id/deactivate` is a soft delete
  (`is_active = 0`).
- **Search.** `GET /api/wishes` selects up to **`LIMIT 50`** active wishes
  matching the `LIKE` query, then filters the page in JS with `isCompatible`
  (the matching engine). Anonymous callers pass one-off searcher attributes as
  `sg` / `so` / `sr` query params; logged-in callers use their stored profile.
- **Where a wish is rendered.** `WishCard` (`src/client/src/components/WishCard.tsx`)
  is the shared card. It already conditionally renders a `FlagButton` when given
  an `onFlag` prop, an admin **Delete** button when given `onAdminDelete`, and a
  Wishmail button. `SearchPage` (`src/client/src/pages/SearchPage.tsx`) is the
  primary surface; `DisplayPage` and `WishPreview` also render `WishCard`.

## 1. Data model

### Logged-in users — a server-side `wish_exclusions` table

Add a join table keyed by `(user_id, wish_id)`, created in the
`executeMultiple` schema block in `src/server/db.js` alongside the other
`CREATE TABLE IF NOT EXISTS` statements:

```sql
CREATE TABLE IF NOT EXISTS wish_exclusions (
  user_id TEXT NOT NULL,
  wish_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, wish_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
);
```

- The composite primary key makes "exclude" idempotent (`INSERT OR IGNORE`) and
  gives us the lookup index for free.
- **`ON DELETE CASCADE` on both FKs** is deliberate: when a wish is hard-deleted
  (the `/manage` delete path) or a user is deleted, the stale exclusions clean
  themselves up. This matches the `ON DELETE CASCADE` already used for
  `sessions` and `wishmails`.
- Caveat consistent with ADR 0002: FK enforcement is best-effort. On the Pi's
  file DB `PRAGMA foreign_keys = ON` is applied and cascades fire; Turso's
  behavior differs, so the delete paths should not _rely_ on the cascade for
  correctness (see Edge cases). A stale exclusion row is harmless anyway — it
  just references a wish that no longer appears in results.

No `ensureColumn` migration is needed since this is a brand-new table; existing
databases pick it up on next boot via `CREATE TABLE IF NOT EXISTS`.

### Anonymous users — client-side `localStorage`

An anonymous visitor has no durable server key. The issue frames two options:

| Option                           | Cross-user isolation                    | Durable across devices           | Server state for anon            |
| -------------------------------- | --------------------------------------- | -------------------------------- | -------------------------------- |
| **`localStorage` (recommended)** | Perfect — data never leaves the browser | No (per-browser)                 | None (stateless)                 |
| Anonymous session id             | Perfect, if the id is truly per-browser | Yes (per-browser, server-stored) | New id-minting + a storage table |

**Recommendation: `localStorage` for anonymous users.** Store an array of
excluded wish ids under a key such as `wishboard.excludedWishes`. Rationale:

- It is **impossible** for one anon visitor's list to affect another's, because
  there is no shared server row to collide on — this directly satisfies the
  issue's hard requirement.
- It keeps the server **stateless for anonymous traffic**, which matters on the
  serverless/Turso target where every write is a network round-trip and the
  free tier is finite (ADR 0002). Minting and persisting an anon-session id per
  browser is more moving parts, a new table, and a de-facto tracking cookie —
  all for a "not durable across devices" property that a not-logged-in user
  can't reasonably expect anyway. If they want durability, they log in.

The trade-off we accept: an anonymous user's hides don't follow them to a new
device or survive a cache clear. That is the right cost for a hide/undo
convenience feature, and it converts cleanly to durable storage the moment they
create an account (see migration under Edge cases).

## 2. API changes

### Exclude / un-exclude (logged-in only)

Two authenticated endpoints in `src/server/routes/wishes.js`, guarded by the
existing `requireAuth` middleware (which 401s a missing/expired token — anon
callers never reach these, they hide client-side):

```text
POST   /api/wishes/:id/exclude     → INSERT OR IGNORE INTO wish_exclusions (user_id, wish_id, created_at)
DELETE /api/wishes/:id/exclude     → DELETE FROM wish_exclusions WHERE user_id = ? AND wish_id = ?
GET    /api/wishes/exclusions      → list the caller's excluded wish ids (for a "manage hidden" view)
```

- `POST` is idempotent (`INSERT OR IGNORE` against the composite PK), so a
  double-tap or a retry after a `SQLITE_BUSY`/503 (ADR 0002) is safe.
- These mirror flag's shape but, unlike `POST /:id/flag` (which is intentionally
  **unauthenticated** and global), exclude is **per-user and authenticated** —
  it must send `Authorization: Bearer <token>`.

### Filtering excluded wishes out of `GET /api/wishes`

**Logged-in:** filter server-side, in SQL, _before_ the `LIMIT 50`, so excluded
wishes don't eat into the page budget. When `getRequestUser(req)` yields a user,
add an anti-join to both the query and no-query variants:

```sql
... FROM wishes w
LEFT JOIN users u ON w.user_id = u.id
WHERE w.is_active = 1 AND (u.id IS NULL OR u.is_active = 1)
  AND NOT EXISTS (
    SELECT 1 FROM wish_exclusions x
    WHERE x.wish_id = w.id AND x.user_id = ?
  )
ORDER BY w.created_at DESC LIMIT 50
```

The `isCompatible` JS filtering that follows is unchanged; exclusion happens
first, at the data layer.

**Anonymous:** the browser holds the list, so it must travel with the request.
Rather than filter purely in the client (where excluded wishes would still count
against `LIMIT 50` and could crowd out visible ones), the client sends its list
as a query param and the server applies the **same** SQL exclusion — no server
state, identical code path:

```text
GET /api/wishes?q=...&exclude=id1,id2,id3
```

When `exclude` is present, bind the ids into a `NOT IN (...)` (or the same
`NOT EXISTS` against a small VALUES list) clause. Cap the number of ids accepted
(e.g. 200) to bound the query. The client also filters defensively on the
response as a belt-and-suspenders measure and to instantly drop a just-excluded
card without a refetch. Note `SearchPage.search` already builds a
`URLSearchParams` — this is one more `params.set('exclude', ...)`.

## 3. UI

### Where the button goes

Add an **exclude ("Not interested") button to `WishCard`**, right next to
`FlagButton`, gated by a new optional `onExclude?: (id: string) => void` prop
(same pattern as `onFlag` / `onAdminDelete`). Use a distinct icon — an
**eye-off** or an **×/"Hide"** — so it reads as "hide from me," visually
separate from the flag pennant which reads as "report." Wire it in `SearchPage`
(the search grid) at minimum; `DisplayPage` is a public kiosk board and should
**not** show a personal hide control.

### Behavior, confirmation, and undo

- **Low friction, no scary confirm.** Flag intentionally interrupts with
  `window.confirm('… flag this wish as inappropriate?')` because it's a report.
  Exclude is a personal, reversible convenience — it should **not** use a blocking
  confirm. Instead: **optimistically remove the card** (exactly as `useFlagWish`
  does today, `setResults(prev => prev.filter(...))`) and show a brief **"Hidden.
  Undo"** toast/snackbar. "Undo" re-inserts the card and calls the un-exclude
  path.
- **Logged-in:** the button fires `POST /api/wishes/:id/exclude` with the bearer
  token; Undo fires `DELETE`. Add a small **"Manage hidden wishes"** view
  (fed by `GET /api/wishes/exclusions`) — e.g. on the account page — listing
  hidden wishes with an "un-hide" action, so the action is discoverable and
  fully reversible per the issue's "Reversible?" question.
- **Anonymous:** the button mutates the `localStorage` array (add on exclude,
  remove on Undo) and re-runs/filters the current results. No network call. A
  lightweight `useExcludedWishes` hook (parallel to `useFlagWish`) can own both
  the logged-in fetch calls and the anon `localStorage` reads/writes behind one
  interface, so `WishCard` doesn't care which mode it's in.

### How it differs from flag (summary)

|                    | Flag                                 | Exclude                                    |
| ------------------ | ------------------------------------ | ------------------------------------------ |
| Intent             | Report abuse to admins               | Personal "don't show me this"              |
| Scope              | Global (`wishes.flagged`)            | Per user (or per browser for anon)         |
| Auth               | Unauthenticated                      | Logged-in: authenticated; anon: local only |
| Persistence        | Sets a DB flag, emits `wish:flagged` | `wish_exclusions` row / `localStorage`     |
| Reversible by user | No                                   | Yes (Undo + manage view)                   |
| Confirm dialog     | Yes (blocking)                       | No — optimistic with Undo                  |

## 4. Edge cases

- **Anonymous → logs in (migration of local exclusions).** On successful login
  (in `AuthContext`), if `localStorage` holds excluded ids, POST them once to a
  bulk import endpoint — e.g. `POST /api/wishes/exclusions/import` with
  `{ ids: [...] }` — which does `INSERT OR IGNORE` per id for the now-known
  `user_id`, then clear the `localStorage` key on success. This makes the
  visitor's hides durable and cross-device from that point on. Ids referencing
  wishes that no longer exist should be **skipped, not errored** (see next
  point). This is a one-time, best-effort merge; treat a failure as non-fatal
  (keep the localStorage list and retry next login).
- **An excluded wish is later deleted.** The `/manage` delete path is a hard
  `DELETE FROM wishes`. With FK cascade active (Pi file DB) the exclusion row is
  removed automatically. To be robust where cascade may not fire (Turso, per ADR
  0002), the delete handler should also `DELETE FROM wish_exclusions WHERE
wish_id = ?` — cheap and idempotent, and it mirrors how `/manage` already
  explicitly deletes dependent `wishmails` before the wish. Either way a
  leftover exclusion is inert: it points at a wish that can never appear in
  results. For anonymous `localStorage`, stale ids are simply never matched and
  can be pruned opportunistically.
- **Excluded wish is deactivated (`is_active = 0`) then reactivated.** No special
  handling: the exclusion persists and the wish stays hidden for that user when
  it comes back. That's the desired behavior — deactivation is the owner's
  concern, exclusion is the viewer's.
- **Interaction with matching.** Exclusion is orthogonal to compatibility.
  Because we filter exclusions in SQL **before** `LIMIT 50` and **before** the
  JS `isCompatible` pass, hidden wishes never consume the page budget and the
  matching engine (`MATCHING_RULES.md`) sees a clean candidate set. A wish the
  user hid but which would also fail compatibility is simply gone once — no
  double-counting, no ordering surprises.
- **Owner hiding their own wish.** Allowed and harmless — it only affects the
  owner's search view, not the wish's existence or others' views. If undesirable
  we can suppress the button when `wish.user_id === user.id`, but that requires
  the search response to expose ownership, which it currently doesn't; treat as
  optional polish, not a blocker.
- **`exclude` param abuse (anon).** Bound the accepted id count and length, bind
  as parameters (never string-interpolate) to keep the query safe and the plan
  bounded.

## Open questions

- [ ] Does exclude ever hide a wish from the **public display board**
      (`DisplayPage`), or only from the excluding user's search? This design says
      **search only** — the board is a shared kiosk surface with no per-user
      identity. Confirm with the issue author.
- [ ] Do we want the "Manage hidden wishes" view in v1, or ship exclude + Undo
      first and add the management surface as a fast follow?
- [ ] Cap values for the anonymous `exclude` list (id count / total length).

## Consequences

- One new table (`wish_exclusions`), three new authenticated endpoints (plus an
  optional bulk-import), and one new `WishCard` action. No change to the wish
  schema itself.
- `GET /api/wishes` gains a per-user anti-join (logged-in) and an optional
  `exclude` param (anon); the matching engine is untouched.
- Anonymous exclusions stay entirely client-side — zero anon write load on
  Turso, and zero cross-user leakage — converting to durable server rows on
  account creation.
- Flag stays exactly as-is (global abuse report); exclude is the new personal,
  reversible hide.

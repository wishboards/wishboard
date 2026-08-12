---
title: 0004 Kiosk Data Persistence
---

# ADR 0004: Kiosk data persistence (unified bind mount on the Pi)

- **Status:** Accepted — the clobber guard (#193) and the `--reset-rules` fix (#194 via #204) have landed; the DB-volume ownership shape (#145) is resolved by transitioning to a unified host bind mount.
- **Date:** 2026-07

## Context

The Wishboard kiosk runs on a single Raspberry Pi under **rootless Docker**, orchestrated by `docker-compose.yml` and deployed by `scripts/build-kiosk.sh`. Unlike the serverless target (Turso + no local disk, see [ADR 0002](0002-serverless-database-architecture.md)), the kiosk keeps **all** persistent state on the Pi's SD card, unified under the host `./data` directory (bind mount):

- **Uploaded images** in `./data/images/` (mounted as `/app/data/images` in the `wishboard` service).
- **The libSQL database files** in `./data/db/` (mounted as `/var/lib/sqld` in the `db` service).

Since #193/#188, matching **rules live in a `rules` table in the DB**, not in `rules.yaml`. That means rules now sit in the database files under `./data/db/`, while images sit in `./data/images/`.

Three concrete problems motivated this ADR: a **clobber bug** in the legacy-volume migration (fixed with #193), an **ownership decision** under rootless Docker (#145, resolved by switching to bind mounts under matching host UID/GID), and a **destructive, misnamed `--reset-rules`** flag (#194, resolved in #204).

## Architecture

```text
Raspberry Pi (rootless Docker, user: wishboard)
│
└── ./data  ──bind mount──▶  containers
      (host: ~wishboard/wishboard/data)
       ├── data/images/   (uploaded images)   ──▶ wishboard container /app/data/images
       │                                            (user: node:node)
       └── data/db/       (libSQL DB files)   ──▶ wishboard-db container /var/lib/sqld
                                                    (user: WISHBOARD_UID:WISHBOARD_GID)
```

Key point: **images and the DB live under a unified `./data` host directory.** Both are host bind mounts owned by the host `wishboard` user. By running the `db` container as the host user's UID/GID, no permission adjustments or manual `chown` steps are required.

## Decisions & fixes

### 1. Two surfaces, one deploy — keep them distinct

The bind mount (`./data`, images + vestigial `rules.yaml`) and the named volume (`db_data`, the SQLite database including the `rules` table) are treated as separate persistence surfaces with separate reset semantics. Conflating them is what produced #194. Any operation that means "reset the rules" or "reset the images" must target the correct surface and only that surface.

### 2. Guard the one-time legacy-volume migration (clobber bug, fixed alongside #193)

`build-kiosk.sh` migrates the old standalone `wishboard_data` named volume into the `./data` bind mount for deployments upgrading from the pre-compose single-container layout. Because the app container is named `wishboard` **even under compose**, the "legacy container present" check matched on every deploy, so the `cp -a /from/. /to/` from the stale `wishboard_data` volume ran **every time** — overwriting live data (rules edits, uploaded images) with orphaned, stale content.

It is now guarded to run **only when the bind mount has no data yet** — the copy is skipped unless `DEPLOY_RULES != reset` **and** neither `data/rules.yaml` nor `data/wishboard.db` exists:

```sh
if [[ "$DEPLOY_RULES" != "reset" ]] \
    && [ ! -f "$WISHBOARD_HOME/wishboard/data/rules.yaml" ] \
    && [ ! -f "$WISHBOARD_HOME/wishboard/data/wishboard.db" ]; then
    # first run only: migrate legacy wishboard_data → ./data
fi
```

This makes the migration a genuine one-time, first-run operation instead of a per-deploy clobber.

### 3. Rootless-Docker ownership of the DB volume — resolved (#145)

We transitioned the database storage from a Docker named volume with post-deploy `chown` to a host bind mount `./data/db` (mounted at `/var/lib/sqld`).
To prevent permissions conflicts on the host directory under rootless Docker, the container's execution user is dynamically set to match the host user's UID and GID: `user: "${WISHBOARD_UID:-1000}:${WISHBOARD_GID:-1000}"`.
This allows the `sqld` process to read and write database files naturally without root access or post-deploy permission modifications. The vestigial legacy standalone migration block has been completely removed.

### 4. `--reset-rules` is destructive and misnamed (#194) — fixed in #204

`--reset-rules` maps to `DEPLOY_RULES=reset`, which **used to** do:

```sh
$RUN_CMD volume rm wishboard_data db_data || true
sudo rm -rf $WISHBOARD_HOME/wishboard/data/* || true
```

Post-#188, this is **wrong on both counts**:

- It `rm -rf`s the entire `./data` bind mount, **deleting uploaded images** (`data/images/`) along with the now-vestigial `rules.yaml` — data the flag has no business touching.
- It does **not actually reset the rules**, because rules now live in the DB (`rules` table in the database), reachable only over `http://db:8080`. Wiping the files leaves the real rules untouched.

So the flag was both destructive (images) and ineffective (rules). **Fixed in #204:** the destructive pre-`compose` block is gone; after the stack is up, `--reset-rules` clears the DB `rules` table via the app's own libSQL client (`DELETE FROM rules`) and restarts the app so `rulesManager.seedIfEmpty` reseeds the bundled defaults on boot. It removes only the vestigial legacy `rules.yaml` (so the reseed uses the bundled defaults, not a stale file) and **never** touches `/app/data`, so uploaded images, users, and wishes are preserved.

## Consequences

- The kiosk keeps **all persistent state** under a unified `./data` directory (bind mount): images in `./data/images` and the libSQL database files in `./data/db`.
- The DB volume manual chown loop has been eliminated; the container runs under the matching host user's UID and GID.
- The legacy `wishboard_data` named volume migration code has been removed.
- **`--reset-rules` (fixed in #204)** clears only the DB `rules` table (reseeding the bundled defaults) and leaves `/app/data` — images, and everything else — intact.
- The serverless target is unaffected: it has no local disk, stores the DB (and rules) in Turso, and never uses either kiosk volume (see [ADR 0002](0002-serverless-database-architecture.md)).

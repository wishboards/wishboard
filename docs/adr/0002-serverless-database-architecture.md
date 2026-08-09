# ADR 0002: Serverless database architecture (SQLite-on-EFS vs. managed libSQL)

- **Status:** Accepted — Option 2 (managed libSQL / Turso). Implemented 2026-07-10 (#136 spike → PR #187).
- **Date:** 2026-07 (accepted 2026-07-10)

## Context

Wishboard runs in two topologies from one codebase, unified behind the `@libsql/client` API:

- **Single-node kiosk** (Raspberry Pi / Docker): one Express process, an embedded SQLite file on local disk. This is correct and not in question.
- **AWS serverless**: `ApiFunction` and `WebSocketFunction` Lambdas both mount the **same SQLite file over EFS** (`DATABASE_URL=file:/mnt/efs/wishboard.db`), with **no reserved concurrency**.

The serverless path relies on a single on-disk file shared by multiple, independently-scaling Lambda instances (separate hosts). Investigation found:

- Journal mode is **`delete` (rollback journal)**, not WAL — so this avoids the catastrophic case (WAL requires single-host shared memory and **corrupts** across hosts on a network filesystem). **WAL must never be enabled on the EFS deployment.**
- `busy_timeout` was **0** — overlapping writes failed immediately with `SQLITE_BUSY` rather than waiting.

**Net risk:** not data corruption, but **`SQLITE_BUSY` errors and EFS latency under write concurrency**. Current low traffic masks it — writes rarely overlap. This is a reliability-under-load gap, and it will surface as intermittent failures as volume grows.

An interim mitigation (`PRAGMA busy_timeout = 5000` + a WAL guard comment) ships alongside this ADR, but does not change the topology.

## Decision drivers

- **Cost is the primary constraint.** An always-on database server (RDS/Aurora provisioned) runs 24/7 and bills 24/7 — unacceptable for a low-traffic hobby/convention app. The target is **free-tier or scale-to-zero**.
- Low, bursty write volume; relational schema already on SQLite/libSQL.
- Minimal code change (the client already speaks both file and remote libSQL).
- Correctness under concurrent writers from multiple Lambdas.

## Options

### 1. Keep SQLite-on-EFS + hardening (status quo, hardened)

Add `busy_timeout`, optionally cap writers with `ReservedConcurrentExecutions: 1`.

- **Cost:** ~free — EFS has a free tier (a SQLite file is well under it), and there's **no DB compute to pay for**.
- **Pros:** no new vendor/service, no data leaves AWS, minimal change (mostly this PR).
- **Cons:** reserved concurrency serializes writers (latency/queueing) and caps throughput; EFS adds network-`fsync` latency to every op; SQLite-over-NFS is discouraged for concurrent access even in rollback mode; doesn't truly scale.

### 2. Managed libSQL (Turso) — remote singleton

Point serverless `DATABASE_URL` at a `libsql://…` Turso database; drop the EFS mount.

- **Cost:** Turso's free tier is generous and **usage-based / scale-to-zero** — no always-on charge at low volume.
- **Pros:** a real singleton that serializes writes correctly (no NFS locking, no `SQLITE_BUSY`-from-file-locks), removes EFS entirely, ~one-line change (already using the libSQL client), keeps the same SQL/schema.
- **Cons:** external vendor + network hop (Lambda ↔ Turso latency), data lives outside AWS, subject to free-tier limits/policy changes.

### 3. Always-on relational server (RDS / provisioned Aurora) — rejected

Correct concurrency, but **always-on cost** and operational overhead violate the primary driver. Aurora Serverless v2 scales but bills a non-zero minimum (ACUs) — not truly free at idle. Rejected.

_(Also considered and set aside: Cloudflare D1 — wrong ecosystem, we're on AWS/CloudFront; Neon/DynamoDB — a data-layer rewrite.)_

## Decision (accepted 2026-07-10)

**Option 2 (managed libSQL / Turso) is adopted for the serverless target**, resolving the #136 spike. The serverless `DATABASE_URL` now points at a hosted Turso database (`libsql://…`, co-located in `us-east-1`), the EFS mount is gone, and **both Lambdas leave the VPC entirely** — which was the whole point:

- **Cost:** the VPC existed only to reach EFS. Removing it deleted the CloudWatch + CloudWatch Logs **interface endpoints** that were quietly costing **~$1/day** (~$29/mo) — a cost this ADR's original analysis (and the deploy guide's cost table) missed. Turso itself sits inside its free tier with >100× headroom. Net serverless DB cost: **$0**.
- **Real-time, fixed as a side effect:** an in-VPC Lambda has no egress to `execute-api`, so server→client WebSocket broadcasts silently timed out. A VPC-less Lambda reaches `execute-api` normally, so real-time now works. See [ADR 0003](0003-serverless-realtime-websockets.md).
- **Concurrency:** Turso is a real singleton — no NFS file locking, no `SQLITE_BUSY`-from-EFS, no reserved-concurrency workaround.

Spike results (#136): free-tier limits clear by >100× on every axis (5 GB storage, 500 M row reads/mo, 10 M writes/mo, 100 DBs); the app's real `db.js` init + a write/read roundtrip validated against hosted Turso; Lambda↔Turso latency made negligible by co-locating the Turso primary in `us-east-1` (region `iad`).

The Turso auth token is stored as a SecureString **SSM parameter** and fetched by the Lambda at cold start — never in the template, the deploy command, or CI. See `aws-serverless/deploy-instructions.md`.

## Deployment reality (important context for the decision)

Real high-traffic events (conventions) run on a **dedicated single-node Raspberry Pi**, not on serverless. This reframes the urgency:

- The multi-writer contention problem is essentially a **serverless-only** concern. On the Pi there is one Express process with a single libSQL connection, so DB access is already serialized by the app/event loop — no cross-process lock contention, and `SQLITE_BUSY` is a near-non-event regardless of journal mode.
- So the highest-traffic path (Pi) largely **sidesteps the issue by topology**, and the serverless path is the lower-traffic one. This lowers the pressure to migrate, but doesn't remove the correctness gap for whatever serverless traffic does occur.

### WAL on single-node (Pi) — safe and beneficial, if gated

On the Pi (single host, local disk) **WAL is safe** (its single-host shared-memory requirement is met) and beneficial: readers no longer block the writer, so the big-screen display and attendees' phones can keep searching while wishes are being submitted — valuable on a busy event day. The CPU/SD-wear worry is minor for this low-write workload (sequential WAL appends + small periodic checkpoints; WAL is commonly recommended for embedded/Pi SQLite).

Guardrail: WAL must be **opt-in behind an explicit flag** set only by the single-node/Docker deployment (e.g. `WISHBOARD_DB_WAL=1`), **never auto-enabled** — leaking WAL onto the EFS/serverless file risks cross-host corruption. Do **not** infer "single node" from a `file:` URL (EFS is also `file:`). Candidate follow-up, tracked separately.

### Serverless latency scenarios (where contention would actually bite)

With `busy_timeout=5000` an overlapping write waits rather than fails; added latency ≈ (writers queued ahead) × (per-write lock-hold time, inflated by EFS network `fsync`). It exceeds human tolerance only under: a **synchronized submission burst** (dozens of writers in the same seconds), **WebSocket connection churn** (the WS Lambda writes `websocket_connections` on connect/disconnect), **EFS latency spikes** (inflate every lock-hold at once), or **retry storms**. In rollback-journal mode a writer's EXCLUSIVE lock also briefly **blocks readers**, so a write burst can slow _searches_ too — another reason WAL (unavailable on EFS) or a real singleton (Turso) suits a concurrent serverless topology.

### Graceful failure handling (shipped, topology-agnostic)

Independent of the storage choice, a write that does time out now fails **safely**: a global JSON error handler returns a friendly, retryable `503` for `SQLITE_BUSY` (and JSON, not HTML, for any error), and the client shows a clear message while **preserving the user's entered data** for a one-tap retry. (Previously a non-JSON 500 surfaced as a silent no-op.) This makes an occasional timeout bearable regardless of which option wins.

## Open questions — resolved

- [x] **Turso free-tier fit** — confirmed: projected usage sits >100× under every limit (storage / reads / writes / DB count).
- [x] **Lambda↔Turso latency** — addressed by co-locating the Turso primary in `us-east-1` (region `iad`), next to the stack (~1–2 ms vs. ~150 ms cross-region for the initial Tokyo default).
- [x] **`busy_timeout` on the libSQL connection** — moot on Turso: it rejects the PRAGMA as unsupported, and `db.js` applies PRAGMAs individually + best-effort so it's skipped, not fatal. Still applies to the Pi's file DB.
- [x] **`ReservedConcurrentExecutions: 1`** — not needed; Turso serializes writes server-side, so the EFS multi-writer concern is gone.
- [ ] **WAL on the single-node (Pi)** — still open (tracked in [#239](https://github.com/wishboards/wishboard/issues/239)).

## Consequences

- **Serverless now runs on Turso** (hosted libSQL); the VPC, subnets, IGW, route tables, security group, EFS (filesystem / mount targets / access point), and both CloudWatch interface endpoints are **deleted**. The ~$1/day is eliminated.
- The **kiosk stays embedded file-SQLite** on the Pi (unchanged); one `@libsql/client` codebase still serves both targets.
- The one capability EFS provided beyond the DB — **`rules.yaml` persistence** — is now **resolved in #188**: matching rules live in a `rules` table in the DB (seeded from a bundled default), on both the Pi and serverless. (Interim state after this ADR was ephemeral `/tmp`, which is why live serverless rules briefly dropped to zero.) EFS was ruled out for rules because it would require putting the Lambda back in a VPC, which then can't reach Turso.
- Graceful write-failure handling (JSON errors, friendly retry, preserved form data) remains part of the baseline.
- **WAL is now a non-issue on serverless** (no EFS); it stays a gated opt-in for the Pi only.

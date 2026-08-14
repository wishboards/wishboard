---
title: '0004: Reject Fine-Grained Turso Permissions (Table-Level Only)'
date: 2026-08-14
status: rejected
---

# ADR 0004: Reject Fine-Grained Turso Permissions (Table-Level Only)

## Context

As part of defense-in-depth thinking spurred by the possibility of integrating online boards with hosting organizations' single sign-on providers, an investigation was conducted to determine if Turso's fine-grained permission model could be used to implement On-Behalf-Of (OBO) JWTs. The goal was to secure the database at the row level—for example, ensuring that an owning user could only edit or delete their _own_ wish, even if the application API logic failed to perform the authorization check.

In this proposed architecture, the backend would mint a custom JWT containing specific permissions (e.g. `wishes:data_update`) signed by the application's private key. The public key (JWKS) would be registered with Turso. The Node.js libSQL client would be instantiated dynamically per-request, passing the user-specific OBO token to the Turso backend.

## Decision

**Rejected.** Turso's current fine-grained permission model operates strictly at the _table and action level_ (e.g. `wishes:data_update`), not at the _row level_. It is impossible to encode an instruction into a Turso token that restricts `data_update` to rows matching `user_id = <current-user>`. Therefore, replacing the global API database token with user-specific OBO tokens would not prevent an exploited API from modifying another user's wish.

Furthermore, implementing this feature would add significant architectural complexity:

1.  **Local SQLite Kiosk Compatibility:** The application must continue to support local file-based SQLite deployments (e.g., Raspberry Pi kiosks). Local SQLite does not support Turso JWT validation. A split-brain architecture where serverless deployments dynamically instantiate `@libsql/client` while local deployments use a global singleton creates maintenance overhead and increases the risk of branching regressions.
2.  **Performance:** Dynamically creating a new `@libsql/client` per request could introduce connection pooling and latency overhead, especially in serverless environments.
3.  **Token Leakage Risk:** Handling raw DB tokens (even fine-grained ones) on a per-user basis introduces the risk of leaking tokens to the frontend if an endpoint mistakenly exposes the minted token.

## Consequences

- We will continue to rely on application-level API logic (e.g., `user.id === row.user_id`) to enforce row-level access control.
- The `DATABASE_AUTH_TOKEN` pattern remains a backend-only singleton secret.
- If row-level security (RLS) becomes a strict requirement in the future, we will need to evaluate alternative solutions, such as database-level triggers that validate against a session variable (which is difficult in SQLite) or a different database provider entirely.

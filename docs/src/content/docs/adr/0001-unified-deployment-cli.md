---
title: 0001 Unified Deployment Cli
---
# ADR 0001: Unify cross-platform deployment logic in a Node/TypeScript CLI

- **Status:** Accepted (implemented — see the unified deployment CLI under `src/cli/`)
- **Context date:** 2026

## Context

Deployment and setup logic (e.g. OIDC role setup/teardown) was duplicated across
parallel `.sh` and `.ps1` scripts. We wanted to maintain the _logical semantics_ of
these processes in one place and avoid maintaining two hand-written copies that drift
apart.

The tempting idea — transpile a single DSL/AST into idiomatic Bash **and** PowerShell —
is not viable: Bash is string/stream-oriented while PowerShell is object-oriented, so a
shared AST produces brittle, unreadable output. There is no widely adopted, production
tool that does this well.

## Decision

Migrate complex deployment logic into a single **Node.js/TypeScript CLI** (under
`src/cli/`) rather than maintaining paired shell scripts. OS differences are handled
_inside_ the code (e.g. branching on `os.platform()`), and the CLI can be distributed as
a bundled `.js` artifact (via `esbuild`, see the `build:cli` script) or a standalone
executable, with a tiny bootstrap script only where Node is not yet installed.

This leverages the team's existing TypeScript expertise, gives type safety and unit
testability for infrastructure steps, and keeps a single source of truth.

## Alternatives considered

- **Compiled Go/Rust CLI** — true single binary with zero runtime deps, but introduces a
  new language to a TypeScript-heavy codebase; OS-specific branching is still required.
- **Ansible** — matches the "logical semantics in one place" goal and is idempotent, but
  does not emit standalone scripts and requires a Python control node, which does not fit
  a "download and run locally" model for casual users.
- **Task runners (`go-task`, `just`)** — unify the developer entry point but neither
  generate standalone scripts nor abstract OS differences; the duplication just moves
  into the task file.

## Consequences

- **Pros:** drastically reduced duplication, type-safe and unit-testable deployment
  logic, contributors work in the language they already use.
- **Cons:** upfront cost to port existing Bash/PowerShell into TypeScript, plus a build
  step to bundle/compile the CLI into distributable artifacts.

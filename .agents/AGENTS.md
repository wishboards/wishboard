# Project Style Guidelines & Conventions

This document outlines the core coding conventions, architectural patterns, environment rules, git workflows, and testing guidelines for the **Wishboard** project. All autonomous agents and developers working on this project should adhere to these principles.

---

## 1. Project Context & Stack

- **Description:** A private, disconnected wish board for conventions running on local hardware (e.g., Raspberry Pi 4) or deployed via an AWS serverless stack (Lambda + API Gateway + CloudFront + S3 + hosted Turso/libSQL; no VPC or EFS).
- **Backend:** Node.js (ES modules), Express, SQLite (`libsql` or native sqlite3), WebSockets (using `socket.io` for standard and AWS API Gateway for serverless).
- **Frontend:** React, TypeScript, Vite.
- **Database:** SQLite. Remote database migrations are handled via custom local-to-remote migration scripts.

---

## 2. Coding & Syntax Conventions

- **Global Accessors:** In TypeScript files, always prefer `globalThis` over `window`, `self`, or `global` to align with SonarQube quality gate conventions and maintain environment-agnostic execution.
- **Conventional Commits:** Always use conventional commit structures (e.g., `feat:`, `fix:`, `refactor:`, `test:`, `docs:`) for git commits and Pull Request titles. These are used to generate release change logs automatically.
- **Shell Conditionals:** Use `[[` instead of `[` in `#!/bin/bash` scripts. The `[[` construct is safer and more feature-rich. (POSIX `#!/bin/sh` scripts must keep `[`.)
- **Code Quality & Linter Health:** Prefer extracting reusable helpers over duplicating logic; avoid data clumps (pass structured objects, not long parameter lists). Always check for linter/type errors on modified code blocks.
- **Optional Chaining:** Prefer optional chaining (`?.`) over traditional chained conditionals (e.g., `a && a.b`) to prevent IDE static analysis warnings and improve code conciseness.

---

## 3. Architecture & Matching Engine Rules

- **Configuration-Driven Rules:** Do not hardcode gender, orientation, or role matching logic inside the backend code. The matchmaking system uses a dynamic rule system stored in a `rules` table in the DB (seed defaults in `profiles/**/profile.yaml`; edited live via the admin UI).
- **Rule Types:**
  1. `enrichment`: Implicitly adds a target attribute if the trigger matches (e.g., adding `woman` if orientation is `lesbian`).
  2. `acceptance`: Overrides matching to automatically accept a broad set of targets (e.g., pan/queer orientations matching all genders).
  3. `expansion`: Synonyms and variants mapping (e.g., expanding `enby`, `non-binary` to `nonbinary`).
  4. `cross_match`: Bidirectional matches between complementary roles.
- **Extending Matching Logic:** To add support for new identities or matching terms, add/edit rules via the admin UI (they live in the DB) — or change the seed defaults in `profiles/**/profile.yaml` — rather than introducing custom parsing helpers in `src/server/routes/wishes.js`.

---

## 4. Testing & Quality Gates

- **Coverage Threshold:** SonarQube applies an **80% test coverage threshold** specifically to **new code** (deltas) introduced on branches. Ensure any new files, code branches, or features are accompanied by robust unit test coverage.
- **PR Verification & SonarQube MCP Enforcement:** When checking Pull Request status or diagnosing Quality Gate failures, you MUST use the SonarQube MCP tools (`get_project_quality_gate_status`, `search_files_by_coverage`, and `get_file_coverage_details`) to retrieve exact line-by-line coverage data rather than relying solely on local test runs or manual diff estimation. Never abandon MCP tool calls if schema errors occur; correct the arguments and retry.
- **Testing Commands:**
  - Run unit & integration test suite:

    ```bash
    npm test
    ```

  - Run tests in watch mode:

    ```bash
    npm run test:watch
    ```

  - Run end-to-end Playwright tests:

    ```bash
    npm run test:e2e
    ```

- **Local Environment:** The repository ships a dev container (`.devcontainer/`) providing Node 24, both npm projects' dependencies, Playwright browsers, Husky hooks, `gh`, the AWS CLI, and `gitleaks`. Prefer it — it makes every gate below runnable locally, which is the difference between diagnosing a failure in seconds and round-tripping through CI. See `CONTRIBUTING.md`.
- **Lint / Type-check / Format:** The project uses ESLint (flat config in `eslint.config.js`) and Prettier. Run these before committing:

  ```bash
  npm run lint         # ESLint (use lint:fix to auto-fix)
  npm run type-check   # tsc against tsconfig.build.json (app source, excludes tests)
  npm run format:check # Prettier verification (use format to write)
  ```

- **CI Quality Gates:** The `Node.js CI` workflow runs lint, type-check, format-check, build, tests, gitleaks secret scanning, and the SonarQube scan on every push and PR. Git hooks (Husky) also run lint-staged on pre-commit and build + tests on pre-push.
- **Rule Baseline:** `@typescript-eslint/no-explicit-any` and `ban-ts-comment` are set to **warn** (non-blocking); `eslint .` fails CI only on errors. Prefer fixing warnings in code you touch rather than adding new ones.
- **Tests Must Not Depend on Where the Module Runs:** If the code under test has a filesystem or environment fallback, **mock that fallback explicitly**. A test that passes only because a path failed to resolve is not a test, and it will behave differently under Stryker, which executes from a sandbox directory. This exact gap broke mutation testing for days: `getGitRepoInfo` falls back to reading `../../package.json`, the test mocked only `node:child_process`, and the assertion inverted between CI and the Stryker sandbox.
- **Never Use `continue-on-error` to Tolerate an Expected Non-Zero Exit:** It suppresses _all_ failures, not just the expected one, and reports genuine breakage as a green check. Configure the tool not to fail instead — `stryker.config.json` already sets `thresholds.break: null`, so surviving mutants exit 0 and the flag was pure downside. If a step may legitimately fail, gate the specific condition and keep artifact upload on `if: always()`.
- **Mutation Testing Is Nightly, Never On Push:** A full Stryker run takes **2.5-5 hours**. It lives in `.github/workflows/stryker.yml` on a `schedule` + `workflow_dispatch` trigger and must never gain a `push` trigger. It publishes nothing; it uploads a `mutation-report` artifact.
  - `.github/workflows/pages.yml` is the **single GitHub Pages deployer**. It builds the docs, pulls the most recent successful `mutation-report`, and also runs on `workflow_run` when Stryker finishes. Do not merge these two workflows back together, and do not add a second workflow that deploys Pages — two deployers race for one Pages source.

---

## 5. Git & Pull Request Workflow Guidelines

- **PR Titles:** Pull Request titles must follow conventional commit naming (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`) as they form the squash commit title used for release changelogs.
- **Never Lead a Title With an Emoji.** `release-please-config.json` uses stock defaults, so the conventional-commits parser requires the type at the **very start** of the subject. A leading emoji makes the whole commit unparseable: it is **silently dropped from `CHANGELOG.md` and does not bump the version**. Put the emoji after the colon instead.

  ```text
  🔒 fix: prevent command injection    # WRONG — vanishes from the changelog
  fix: 🔒 prevent command injection    # correct
  ```

  Only `feat`/`fix`/`perf`/`deps`/`revert` produce visible entries; `test`, `refactor`, `docs`, `chore`, `ci`, and `style` are hidden sections either way. Two ways to correct a title without rewriting history:
  - **At merge time:** `gh pr merge <n> --squash --subject "perf(db): ..."` authors the squash commit directly, leaving the PR title and existing commits untouched.
  - **After merge:** append a commit-override block to the **merged PR's body**, then re-run the `Release & Publish` workflow (`gh run rerun <id>` — it is `push`-triggered only). Release-please re-reads the PR body and uses the override:

    ```text
    BEGIN_COMMIT_OVERRIDE
    test: make getGitRepoInfo tests independent of the module's location
    END_COMMIT_OVERRIDE
    ```

- **Rebase Long-Lived Branches; Do Not Merge `main` Into Them.** Any branch open more than a day or two should be rebased onto `main` before review. Merging `main` in produces a tangled history and, worse, leaves the branch reporting **stale CI results** — a fix already on `main` will not clear a failure computed against an old base. Symptom seen in practice: `Unit & Integration Tests (24.x)` failed on every pre-migration-base PR and passed on every recent-base one, with nothing actually wrong in the diffs.
- **Never Commit Conflict-Resolution or Patch Artifacts.** `*.orig`, `*.rej`, and `patch*.diff` are now in `.gitignore`, but do not defeat it with `git add -f`. These have reached PR branches before (`patch.diff`, `patch2.diff`, `wishes.js.orig`) and are never an intended deliverable.
- **Auto-Closing Issues:** Always include issue auto-closing keywords in the PR body (e.g., `Fixes #<issue_number>` or `Closes #<issue_number>`) so linked issues automatically resolve upon PR merge.
- **Remote Branch Deletion:** Pass `--no-verify` when executing `git push origin --delete <branch_name>` to bypass pre-push hooks during branch cleanup.
- **CI Status Watching:** When waiting for GitHub PR status checks, use `gh pr checks <pr> --watch` rather than repeatedly polling or executing status checks in a loop.

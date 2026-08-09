---
applyTo: 'src/**,scripts/**,aws-serverless/**'
---

Guidelines for using the SonarQube MCP server on this repository (Wishboard).
Scoped to the code Sonar actually scans (`sonar.sources=src,scripts,aws-serverless`)
so it doesn't nag on docs / BACKLOG / CI-YAML-only work.

# Project identity

- SonarCloud project key: `wishboards_wishboard` (organization `wishboards`, region EU).
- This is auto-resolved from `.sonarlint/connectedMode.json` (checked in), so you normally
  do **not** need `search_my_sonarqube_projects` — use the key directly. Only fall back to a
  lookup if that resolution fails.

# Quality gate model (clean as you code)

- The gate evaluates **new code** only: `new_security_rating`, `new_reliability_rating`,
  `new_maintainability_rating`, `new_coverage` (must stay ≥ 80%), `new_duplicated_lines_density`,
  `new_security_hotspots_reviewed`.
- Consequence: fixing **pre-existing / old-code** issues improves ratings but may **not** flip the
  gate. To move the gate, target issues on the new or changed code in the PR/branch.

# Configured exclusions — don't treat these as gaps to "fix"

From `sonar-project.properties`:

- Coverage-excluded: `src/client/src/components/WishScanner.tsx`, `src/client/src/setupTests.ts`
  — 0% coverage on these is by design.
- Analysis-excluded: `**/*.test.*`, `src/client/src/main.tsx`, `aws-serverless/post-build.js`.

# Tool guidelines

## Available tools (SonarQube Cloud MCP)

- The connected server is the SonarQube **Cloud** MCP. It exposes, among others,
  `search_sonar_issues_in_projects`, `get_project_quality_gate_status`, `analyze_code_snippet`,
  `search_security_hotspots`, `show_rule`, `get_component_measures`.
- The tools `analyze_file_list` and `toggle_automatic_analysis` referenced below come from
  **SonarQube for IDE** (local / SonarLint), **not** the Cloud server. Against this repo's Cloud
  MCP they don't exist and are inert — don't debug their absence; just skip them.

## Automatic analysis (SonarQube for IDE only)

- Only when you have changed code Sonar scans **and** the IDE tools exist:
  - At the start of the task, disable automatic analysis with `toggle_automatic_analysis`.
  - At the end, call `analyze_file_list` on the files you created/modified, then re-enable
    automatic analysis with `toggle_automatic_analysis`.
- For non-code tasks, skip this entirely.

## Code language detection

- When analyzing snippets, detect the language from syntax; if unclear, guess from syntax or ask.

## Branch and pull request context

- Many operations support branch/PR-specific analysis. On a feature branch or PR, pass the
  branch / `pullRequest` parameter.

## Verifying fixes

- After fixing issues, do **not** immediately re-query `search_sonar_issues_in_projects` or
  `get_project_quality_gate_status` to confirm — the server reflects changes only after a fresh
  analysis has been ingested. Status lags CI and (per issue #164) can lag even a merge. Re-check
  only once a new analysis has landed.

# Troubleshooting

## Authentication

- SonarQube requires **user** tokens (not project tokens). On `SonarQube answered with Not
authorized`, verify the token type.

## Project not found

- The key is `wishboards_wishboard`; verify spelling. Only reach for `search_my_sonarqube_projects`
  if `.sonarlint/connectedMode.json` resolution fails.

## Snippet analysis

- `analyze_code_snippet` doesn't replace a full project scan; provide full file content for better
  results.

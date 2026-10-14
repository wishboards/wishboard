---
title: 0010 Independent API Versioning Lifecycle
---

# ADR 0010: Independent API Versioning Lifecycle

- **Status:** Implemented
- **Context date:** October 2026

## Context

Wishboard bundles an Express REST API, a React 19 single-page application (SPA), an administrative CLI (`wishboard`), and local kiosk/serverless deployment infrastructure within a single repository.

Previously, the OpenAPI specification's `info.version` was hardcoded to `1.31.0` while the root application had advanced to `1.32.1`. As the Wishboard ecosystem expands—with third-party developers creating custom kiosk skins or client integrations—consumers need an unambiguous way to track the REST API contract version independently from application UI tweaks, kiosk scripts, or CLI bug fixes.

Under the OpenAPI 3.0 specification, `info.version` strictly denotes the version of the _API contract document_, not the server runtime implementation. Coupling the API version directly to every application patch creates artificial version churn and obscures whether the contract actually changed.

## Decision

We decouple the REST API version lifecycle from the root application version, managing both independently within the repository via Google's `release-please` manifest mode:

1. **Independent SemVer for API (`1.0.0`):**
   - The API contract begins at version `1.0.0` tracked in `api/version.txt`.
   - The root application continues its existing versioning line in `package.json` (e.g., `1.32.1`).

2. **Multi-Package Release-Please Automation:**
   - Configure `release-please-config.json` with two components:
     - `.` (`node` release type, excluding `api` path from app bumps).
     - `api` (`simple` release type, tracking `api/version.txt` and `api/CHANGELOG.md`).
   - Use `extra-files` in `release-please-config.json` with JSONPath `$.info.version` to automatically bump `api/openapi.json` whenever an API release is cut.
   - Release tags are named consistently: `wishboard-v*` for application releases and `api-v*` for API releases.

3. **Committed OpenAPI Specification & Drift Enforcement:**
   - Generate `api/openapi.json` from the Zod-to-OpenAPI registry using `scripts/generate-openapi-spec.js` (`npm run api:spec`).
   - Commit `api/openapi.json` directly to Git.
   - CI runs `npm run api:spec:check` on every push and PR to ensure code changes to routes or schemas never drift from the committed specification.

4. **Automated Breaking Change Verification:**
   - CI runs `oasdiff/oasdiff-action/breaking@v0` against `origin/main:api/openapi.json` on pull requests, failing the build on breaking changes (`fail-on: ERR`).
   - Any intentional breaking change to the API must follow conventional commits breaking syntax (`feat(api)!: ...`), triggering an API major bump (`2.0.0`) and corresponding major application bump.

5. **Runtime Exposure:**
   - The runtime configuration endpoint (`GET /api/config`) exposes both `apiVersion` and `appVersion`.
   - The OpenAPI `ConfigResponseSchema` documents both fields, maintaining complete API specification fidelity.

6. **Unversioned REST Endpoints (`/api/...`):**
   - API endpoints remain unversioned (e.g., `/api/wishes`, `/api/users`, `/api/config`).
   - We practice **continuous additive evolution** (adding optional fields, relaxing constraints, and deprecating fields rather than breaking them).

## Alternatives Considered

- **URL Path Versioning (`/api/v1/wishes`):**
  - _Evaluated and rejected._ URIs identify resources, not software builds. Prefixing routes with `/v1` incurs an immediate breaking change for existing deployments and creates severe maintenance overhead if forced to maintain duplicate routing trees, schemas, and test matrices. If an individual endpoint ever requires a radical, non-additive paradigm shift in the future, selective route versioning (e.g., `/api/v2/search`, as used by Mastodon) can be introduced on that specific path without polluting the entire URI namespace.
- **Calendar Versioning (CalVer):**
  - _Evaluated and rejected._ CalVer (e.g., `2026.10`) provides temporal context but conveys no semantic guarantees about backward compatibility. Third-party skinners and client libraries require standard SemVer (`major.minor.patch`) to express compatible version ranges (e.g., `^1.0.0`).
- **Monolithic Version Coupling:**
  - _Evaluated and rejected._ Keeping the API version identical to `package.json` forced `info.version` to increment for CSS fixes, docs rewrites, or devcontainer updates, destroying its utility as an indicator of contract stability.

## Consequences

- **Pros:**
  - Clear, predictable SemVer contract for external UI skinners and third-party event kiosks.
  - Automated detection of spec drift and accidental breaking changes in CI.
  - Docker images and serverless deployments remain gated strictly on root application releases, avoiding unnecessary builds on API-only docs/changelog bumps.
  - Complete compliance with OpenAPI 3.0 semantic guidelines and AGENTS.md fidelity rules.
- **Cons:**
  - Developers modifying routes or schemas must run `npm run api:spec` to update the committed `api/openapi.json`.
  - Maintaining two package components in `release-please-config.json` and `.release-please-manifest.json`.

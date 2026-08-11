---
title: 0008 Automated Documentation Pipeline
---

# ADR 0008: Automated Documentation Pipeline (API, Architecture, UI)

- **Status:** Accepted (Phase 2 implemented)
- **Context date:** 2026

## Context

Wishboard's documentation currently relies on manual updates to Markdown files. As the project's complexity grows across multiple deployment targets (kiosk, local Docker, serverless AWS), keeping manual documentation in sync with codebase changes is increasingly difficult.

Furthermore, API documentation and testing requires developers to manually inspect Express routing files to discover endpoints, payloads, and response structures. The UI component library lacks a centralized sandbox to develop and review isolated components, making accessibility and visual regression testing harder to enforce.

## Decision

We will transition Wishboard to a modern, code-first, and mostly automated documentation stack that stays in lockstep with our TypeScript types and codebase changes. The transition will happen in three distinct phases:

1. **REST API Documentation:** Adopt `zod` alongside `@asteasolutions/zod-to-openapi` to declare request and response schemas directly inside the Express routes. We will serve the resulting `openapi.json` interactively on live instances using Scalar (`@scalar/express-api-reference`).
2. **Architecture & Guide Site:** Migrate raw Markdown guides and ADRs into Starlight (by Astro), leveraging its built-in Pagefind client-side search engine. This will be automatically published to GitHub Pages.
3. **React UI Component Documentation:** Introduce Storybook to document and isolate React UI components (`src/client/`). Integrate `@storybook/addon-a11y` into the CI pipeline for automated accessibility checks.

## Alternatives considered

- **JSDoc/TSDoc to Swagger (e.g. `swagger-jsdoc`):** Requires writing verbose YAML/JSON schemas inside block comments. They easily drift from actual TypeScript implementations. Zod provides runtime validation _and_ generates the OpenAPI spec from the exact same source of truth.
- **Docusaurus or Nextra:** Both are excellent React-based documentation frameworks, but Astro's Starlight + Pagefind provides superior client-side search with zero external dependencies, making it more resilient and lighter for offline/Wi-Fi kiosk environments.
- **Redoc or Swagger UI:** Standard UI tools for OpenAPI, but Scalar provides a more modern, cleaner interface out of the box with embedded API client testing capabilities.

## Consequences

- **Pros:**
  - Guaranteed alignment between API documentation and runtime validation.
  - Searchable, zero-dependency offline documentation for developers.
  - Isolated component development and automated accessibility testing.
- **Cons:**
  - Initial overhead of rewriting existing Express routes to use Zod validation middleware.
  - Adding multiple new tools (Starlight, Storybook, Zod) to the repository dependency tree.

## Tracking

- Phase 2 (Astro Starlight) and dynamic repository identity injection implemented via PR referencing [#344](https://github.com/wishboards/wishboard/issues/344).
- Phase 1 (REST API Documentation) and Phase 3 (Storybook UI) are deferred and tracked via [#344](https://github.com/wishboards/wishboard/issues/344) and [#398](https://github.com/wishboards/wishboard/issues/398) in BACKLOG.md.

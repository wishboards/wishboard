---
title: Mutation Testing with Stryker
---

Wishboard uses [Stryker](https://stryker-mutator.io/) to perform **mutation testing** on both the frontend and backend codebase. Mutation testing helps us guarantee the robustness of our unit and integration tests by automatically inserting small logic bugs (mutants) into the codebase and verifying that our test suite catches them.

## Daily Automated Run

Stryker can take several hours to evaluate the entire project because it runs the complete test suite thousands of times (once for every generated mutant).

To avoid slowing down local development and Pull Requests, we have configured a GitHub Actions workflow (`.github/workflows/stryker.yml`) to automatically run the full suite every night at midnight UTC.

### Two-Workflow Publishing Architecture

To ensure deterministic deployment and avoid race conditions, mutation report publishing is split across two workflows:

1. **Nightly Mutation Run (`.github/workflows/stryker.yml`)**: Runs nightly on a `schedule` + `workflow_dispatch` trigger. It evaluates mutations across the project and uploads a `mutation-report` artifact upon completion. It holds minimal permissions (`contents: read`) and publishes nothing directly.
2. **Single GitHub Pages Deployer (`.github/workflows/pages.yml`)**: Acts as the sole deployer for GitHub Pages. It triggers on pushes to `main` as well as upon `workflow_run` completion of Stryker. It builds the documentation site, downloads the latest successful `mutation-report` artifact, and deploys both under the unified GitHub Pages site.

To enable GitHub Pages in your own fork or repository:

1. Go to your repository's **Settings** tab on GitHub.
2. Select **Pages** from the left-hand sidebar menu.
3. Under **Build and deployment** > **Source**, select **GitHub Actions** (rather than "Deploy from a branch"). Once configured, `.github/workflows/pages.yml` handles deployment automatically.

---

## Running Stryker Locally

If you are working on a specific feature or file and want to see how robust your tests are before committing, you can run Stryker locally on a targeted subset of the codebase.

1. **Build the Application First**: Stryker tests our frontend production bundle routing, so you must always ensure the `dist/` directory is built and up to date before running it.

   ```bash
   npm run build
   ```

2. **Run Stryker on a Specific File or Line Range (Paired with `-t` Test Files)**:
   Always pair `-m` (`--mutate`, which supports `:startLine-endLine` ranges) with `-t` (`--testFiles`) when validating a feature locally. Without `-t`, Stryker's initial dry run executes all 140+ test files in the repository before testing the first mutant; with `-t`, targeted runs finish in under a minute and stream progress live:

   ```bash
   # Mutate an entire file against its dedicated unit tests
   npx stryker run -m src/server/db.js -t src/server/db.test.js

   # Mutate specific modified line ranges across multiple files
   npx stryker run \
     -m "src/server/auth.js:131-149,src/server/socket.js:24-60" \
     -t "src/server/auth.test.js,src/server/socket.test.js" \
     --reporters clear-text,progress
   ```

3. **Validating Test Runner Configurations (`--dryRunOnly`)**:
   When verifying or troubleshooting local test runner configurations or Vitest setup changes, use `--dryRunOnly` as the recommended pattern. This executes only the initial test run across configured Vitest projects without evaluating mutations, confirming sandbox stability and test runner compatibility in seconds:

   ```bash
   npx stryker run \
     -m "src/server/version.js,src/client/src/utils/contrast.ts" \
     -t "src/server/version.test.js,src/client/src/utils/contrast.test.ts" \
     --dryRunOnly --reporters clear-text --concurrency 1
   ```

4. **Run Stryker on a Directory**:

   ```bash
   npx stryker run -m src/server/routes
   ```

5. **View Local Results**: Once complete, Stryker will generate a local HTML report in `reports/mutation/index.html` which you can open in your browser.

## Configuration & Architecture

Stryker is configured via `stryker.config.json` with dedicated Vitest settings in `stryker.vite.config.ts`.

### Key Configuration Practices:

1. **Relocated Test Setup**: Test setup infrastructure and global mocks live in `tests/setupTests.ts` rather than the `src/` source tree. This ensures Stryker `mutate` patterns target pure application logic without generating noise for mock setups.
2. **Boilerplate & Entry Point Exclusions**: Entry points and process bootstrap files without business logic (`src/server/index.js`, `src/client/src/main.tsx`) are excluded in `stryker.config.json`. The declarative OpenAPI registry (`src/server/docs/openapi.js`) is excluded for the same reason: it is a Zod schema/document definition whose string and object literals are documentation metadata (e.g. `.openapi({ example: … })`), not executable logic. Its correctness is verified by the generated-spec check (`npm run api:spec:check`), the OpenAPI unit tests, and the client↔server contract-guard integration test — not by mutation of its example strings. At the time of exclusion it contributed 1,120 mutants at a 4.7% score, almost entirely unkillable StringLiteral/ObjectLiteral mutants, which masked the score of the executable code around it.
3. **Vite Sandbox Stability (`stryker.vite.config.ts`)**:
   - Excludes `src/server/index.test.js` and `tests/integration/client-server-route-guard.integration.test.js` to prevent Express server process listener sandbox collisions and route guard conflicts. Because `include`/`exclude` are defined per Vitest project (`client` and `node` in `vite.config.ts`), these exclusions are applied to each project as well as at the root test configuration level for defense-in-depth.

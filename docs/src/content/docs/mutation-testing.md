---
title: Mutation Testing
---

# Mutation Testing with Stryker

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

2. **Run Stryker on a Specific File**: We highly recommend running Stryker on specific files using the `-m` (mutate) flag to save time.

   ```bash
   npx stryker run -m src/server/db.js
   ```

3. **Run Stryker on a Directory**:

   ```bash
   npx stryker run -m src/server/routes
   ```

4. **View Local Results**: Once complete, Stryker will generate a local HTML report in `reports/mutation/html/index.html` which you can open in your browser.

## Configuration & Architecture

Stryker is configured via `stryker.config.json` with dedicated Vitest settings in `stryker.vite.config.ts`.

### Key Configuration Practices:

1. **Relocated Test Setup**: Test setup infrastructure and global mocks live in `tests/setupTests.ts` rather than the `src/` source tree. This ensures Stryker `mutate` patterns target pure application logic without generating noise for mock setups.
2. **Boilerplate & Entry Point Exclusions**: Entry points and process bootstrap files without business logic (`src/server/index.js`, `src/client/src/main.tsx`) are excluded in `stryker.config.json`.
3. **Vite Sandbox Stability (`stryker.vite.config.ts`)**:
   - Excludes `src/server/index.test.js` to prevent Express server process listener sandbox collisions.
   - Forces `pool: 'forks'` to isolate test worker environments.

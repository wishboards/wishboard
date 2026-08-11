---
title: Mutation Testing
---

# Mutation Testing with Stryker

Wishboard uses [Stryker](https://stryker-mutator.io/) to perform **mutation testing** on both the frontend and backend codebase. Mutation testing helps us guarantee the robustness of our unit and integration tests by automatically inserting small logic bugs (mutants) into the codebase and verifying that our test suite catches them.

## Daily Automated Run

Stryker can take several hours to evaluate the entire project because it runs the complete test suite thousands of times (once for every generated mutant).

To avoid slowing down local development and Pull Requests, we have configured a GitHub Actions workflow (`.github/workflows/stryker.yml`) to automatically run the full suite every night at midnight UTC.

### GitHub Pages Setup (For Forks & New Repositories)

To publish the daily mutation testing report to GitHub Pages in your own fork or repository:

1. Go to your repository's **Settings** tab on GitHub.
2. Select **Pages** from the left-hand sidebar menu.
3. Under **Build and deployment** > **Source**, select **GitHub Actions** (rather than "Deploy from a branch").
4. The `.github/workflows/stryker.yml` workflow includes all required permissions (`pages: write` and `id-token: write`). Once GitHub Pages source is set to **GitHub Actions**, the daily workflow will automatically build and publish the HTML report upon completion.

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

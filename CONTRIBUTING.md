# Contributing to Wishboard

First off, thank you for considering contributing to Wishboard! It's people like you that make open source projects such a great community to learn, inspire, and create.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Wishboard. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Check if the bug has already been reported.**
- **Use a clear and descriptive title** for the issue to identify the problem.
- **Describe the exact steps which reproduce the problem** in as many details as possible.
- **Provide specific examples to demonstrate the steps**. Include links to files or copy/pasteable snippets, which you use in those examples.
- **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
- **Explain which behavior you expected to see instead and why.**

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Wishboard, including completely new features and minor improvements to existing functionality.

- **Use a clear and descriptive title** for the issue to identify the suggestion.
- **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
- **Provide specific examples to demonstrate the steps** or mockups of the desired interface.
- **Describe the current behavior** and **explain which behavior you expected to see instead** and why.
- **Explain why this enhancement would be useful** to most Wishboard users.

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Coding style is enforced by ESLint and Prettier — run `npm run lint` and `npm run format` before committing (the pre-commit hook also does this for staged files).
- Include screenshots and animated GIFs in your pull request whenever possible.
- End files with a newline.
- Add or update unit tests to maintain test coverage for new or modified code.

CI runs lint, type-check, format-check, build, tests, gitleaks secret scanning, and a SonarQube scan on every pull request; all must pass before merging.

## Development Setup

### Option A: Dev container (recommended)

The repository ships a dev container that provisions everything CI uses, so the
checks you run locally match the checks that gate your PR.

1. Install [Docker](https://www.docker.com/) (or Podman) and the
   [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
   for VS Code.
2. Open the repository and choose **Reopen in Container**.
3. Wait for the one-time setup, which installs dependencies for both npm
   projects (root and `docs/`), the Playwright browsers, and the Husky git hooks.

It provides Node 24 (matching the `pages.yml` job and the top of the CI test
matrix), the GitHub CLI, the AWS CLI for the serverless target, and `gitleaks`
for running the secret scan locally.

`node_modules` is kept on named volumes rather than the bind mount. This is
deliberate and worth preserving: installing into a bind-mounted host filesystem
is pathologically slow (10+ minutes on Windows) and is the main reason this
container exists.

Ports `3000` (app) and `4321` (Starlight docs) are forwarded automatically.

> Mutation testing is intentionally not part of the container workflow — a full
> Stryker run takes 2.5-5 hours and runs nightly in CI. See `AGENTS.md` §4.

### Option B: Local toolchain

1. **Clone the repository:**
   `git clone https://github.com/wishboards/wishboard.git`
2. **Install dependencies:**
   Navigate into the repository directory and run `npm install`.
   The documentation site under `docs/` is a **separate npm project** — run
   `npm --prefix docs install` as well if you intend to touch it.
3. **Run the development server:**
   Start the local dev environment with `npm run dev`. This will launch both the Node backend and the Vite frontend.
4. **Run tests:**
   Verify your changes with `npm run test` and `npm run test:coverage`.
5. **Lint, format, and type-check:**
   Run `npm run lint`, `npm run format`, and `npm run type-check` before committing. Husky installs git hooks on `npm install`: a pre-commit hook auto-lints and formats staged files, and a pre-push hook builds and runs the tests.
6. **Documentation site:**
   Build it with `npm --prefix docs run build` if you change anything under
   `docs/`. Note that the build exiting 0 does not mean the site is correct —
   check the rendered output in `docs/dist/`, since a broken `base`, missing
   frontmatter, or a bad sidebar slug can all produce a technically successful
   build that publishes an unusable site.

## License Limitations

Please note that this project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0)**. By contributing, you agree that your contributions will be licensed under the same terms. Commercial use is not permitted without explicit written agreement from the original author.

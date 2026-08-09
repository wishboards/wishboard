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

1. **Clone the repository:**
   `git clone https://github.com/wishboards/wishboard.git`
2. **Install dependencies:**
   Navigate into the repository directory and run `npm install`.
3. **Run the development server:**
   Start the local dev environment with `npm run dev`. This will launch both the Node backend and the Vite frontend.
4. **Run tests:**
   Verify your changes with `npm run test` and `npm run test:coverage`.
5. **Lint, format, and type-check:**
   Run `npm run lint`, `npm run format`, and `npm run type-check` before committing. Husky installs git hooks on `npm install`: a pre-commit hook auto-lints and formats staged files, and a pre-push hook builds and runs the tests.

## License Limitations

Please note that this project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0)**. By contributing, you agree that your contributions will be licensed under the same terms. Commercial use is not permitted without explicit written agreement from the original author.

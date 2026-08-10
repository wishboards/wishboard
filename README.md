# Wishboard

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=wishboards_wishboard&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=wishboards_wishboard)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=wishboards_wishboard&metric=coverage)](https://sonarcloud.io/summary/new_code?id=wishboards_wishboard)
[![Mutation Status](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fwishboards%2Fwishboard%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/wishboards/wishboard/main)

Offline wish board for conventions, built to run on a Raspberry Pi or similar local device.

## Goals

- Run entirely disconnected from the Internet
- Provide tablet/kiosk views for wish entry and search
- Provide a rotating big-screen display of active wishes
- Support admin review and removal of flagged content
- Use a lightweight local database and open source stack
- Support identity-aware search compatibility for wishes and users

## Architecture

- Backend: Node.js + Express
- Database: libSQL/SQLite — a local file under `data/` for a bare `npm start`; the Docker/kiosk path runs a separate `libsql-server` container, and serverless uses hosted Turso
- Frontend: React + Vite
- Offline Hosting: static assets served locally by Express

## Project structure

- `src/server/` — backend API and static file serving
- `src/client/` — React app for kiosk, search, admin and display
- `data/` — local libSQL/SQLite file + uploaded images (bare install / kiosk bind mount)

## Getting started

### Using Docker (Recommended)

You can run Wishboard using the pre-built Docker container and `docker-compose.yml` published in this repository:

```bash
docker compose up -d
```

This will automatically pull the necessary images and start both the Wishboard backend and its internal libSQL database instance.

### AWS Serverless Deployment

For cloud deployments, Wishboard can be deployed to your own AWS account using **AWS SAM (CloudFormation)**, running completely serverless on Lambda, API Gateway, S3, CloudFront, and a hosted **Turso** (libSQL) database — no VPC or EFS.

Deployments are fully automated via **GitHub Actions** and an OIDC connection, so you don't need to manually configure infrastructure after the initial setup.

See the [**AWS Deployment Guide**](aws-serverless/deploy-instructions.md) for step-by-step setup instructions, teardown procedures, and pricing estimates.

### Local Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the client and start the server:

   ```bash
   npm start
   ```

3. Open a browser to `http://localhost:3000`

## Development

- `npm run dev` — start Vite development server for the client and the Express backend concurrently with hot-reloading
- `npm run build` — produce production assets in `dist/`
- `npm start` — build and launch the Express server
- `npm test` — run the test suite
- `npm run test:coverage` — run tests with coverage reporting
- `npm run lint` — lint the codebase with ESLint (`npm run lint:fix` to auto-fix)
- `npm run type-check` — type-check the app source with the TypeScript compiler
- `npm run format` — format the codebase with Prettier (`npm run format:check` to verify only)

### Code quality & git hooks

Husky git hooks run automatically: a **pre-commit** hook lints and formats staged files
(via lint-staged), and a **pre-push** hook builds and runs the test suite. The same
checks — lint, type-check, format, build, tests, gitleaks secret scanning, and the
SonarQube scan — also run in CI on every push and pull request.

## Documentation

Wishboard features a comprehensive, searchable documentation site powered by Astro Starlight. The documentation is automatically built and deployed to GitHub Pages.

👉 **[View the Wishboard Documentation](https://wishboards.github.io/wishboard)** _(Note: If you have forked this repository, this will be your fork's GitHub Pages URL)_

The documentation includes:

- **Deployment Guides** - Instructions for local kiosks and AWS Serverless.
- **Matching Rules** - Deep dive into the identity matchmaking engine.
- **Event Profiles** - Guide for managing multiple event configurations.
- **Architecture & Design** - Technical decisions (ADRs) and design documents.
- **Forking Guide** - Setup instructions for bootstrapping CI pipelines on a fork.

The raw Markdown source files for the documentation are located in `docs/src/content/docs/`.

## User Interface

- The web interface is **mobile-first** and features large tap targets suitable for kiosk touchscreens. Identity fields use tap-friendly autocompletion suggestion pills.
- The UI is **self-documenting**: users can tap the inline info toggle (`ⓘ`) next to input fields to read conversational, non-intrusive help text explaining how matchmaking and attributes work.
- **Cross-device continuity**: To support users switching from kiosks to phones, the system generates QR codes encoding deep links. Anonymous wish creators can scan a QR code to securely manage their specific wish on their phone, and registered users can scan a QR code from their account page to instantly auto-login via a session token URL.
- **Anonymous Wish Claiming**: Registered users can adopt previously anonymous wishes into their account using the wish ID and passphrase.

## Remote access

- The production server listens on all network interfaces by default, so remote developers can access the app if the host is reachable on port `3000`.
- Use `http://<host>:3000/` to open the live preview.
- For cloud or tunneling-based development, expose port `3000` securely and point collaborators to the same URL.

## Contributing & Releases

Wishboard uses `release-please` and GitHub Actions to automatically manage semantic versioning and changelogs.

- To cut a new release, merge a Pull Request into `main` using Conventional Commits (e.g., `feat: added poster`, `fix: proxy error`).
- A Release PR will automatically be opened. Merging that PR will publish a new Docker image to `ghcr.io`.

## Administration & Monitoring

- **Admin Account**: An admin account is created automatically on first run. Default credentials can be customized via `WISHBOARD_ADMIN_USERNAME` and `WISHBOARD_ADMIN_SECRET` environment variables.
- **Log Viewer**: Application logs and web requests are recorded to rotating files in `data/logs`. Admins can view a live-tailing log feed directly within the Admin Dashboard (serving from AWS CloudWatch Logs in serverless mode).
- **Live Metrics Dashboard**: Real-time performance dashboards built natively with Recharts. Depending on deployment mode, admins see either in-process local metrics (CPU, heap usage, RSS memory, OS load average, HTTP request rates, and response latencies) or live CloudWatch metrics (for AWS Lambda, API Gateway, and CloudFront).
- **Demo Seeder**: The admin panel includes a demo seeder to populate users and wishes for development or testing.

## Administration CLI

Wishboard provides a unified command line interface (`wishboard`) to automate deployments, configure environments, and manage OIDC authentication.

### Installation

During local development, you can invoke the CLI directly using Node:

```bash
node src/cli/wishboard.js --help
```

Or run it via `npx` once dependencies are installed:

```bash
npx wishboard --help
```

### Supported Commands

#### GitHub Actions OIDC Setup & Teardown

Configure or destroy GitHub Actions OIDC authentication with AWS:

```bash
# Setup OIDC template and configure repository secrets/variables
npx wishboard oidc setup --org <github_org> --repo <repo_name> --region <aws_region>

# Teardown OIDC template and delete secrets/variables
npx wishboard oidc destroy --org <github_org> --repo <repo_name> --region <aws_region>
```

Add `--dry-run` to preview the underlying commands without executing them.

#### Kiosk & Remote Deployments

Deploy Wishboard to a Raspberry Pi kiosk over SSH with a specific event profile:

```bash
# Deploy to Raspberry Pi using default 'lifestyle' profile
npx wishboard kiosk deploy --user pi --host raspberrypi.local --mode dev

# Deploy with a custom event profile (e.g., professional conference)
npx wishboard kiosk deploy --event-profile professional --mode dev
```

#### AWS Serverless Deploy & Teardown

Build and deploy (or tear down) the serverless stack:

```bash
# Deploy: build frontend + backend, deploy the stack, upload assets, invalidate CloudFront
npx wishboard serverless deploy --mode dev --event-profile lifestyle --region <aws_region>

# Deploy only the frontend to an already-deployed stack with a professional profile
npx wishboard serverless deploy --frontend-only --event-profile professional

# Tear down a stack (a non-dev/production stack additionally requires --force)
npx wishboard serverless destroy --stack-name <stack> --force
```

Options fall back to `aws-serverless/samconfig.toml`, then to your AWS config. Add `--dry-run` to preview the commands, or `--guided` to force the interactive first-time `sam deploy` setup.

#### Database Administration

Reset passwords or matching rules in the Wishboard database:

```bash
# Reset a user passphrase (remote URLs optionally supported via --url and --admin)
npx wishboard db reset-password <username> [new_passphrase]

# Reset matching rules to bundled defaults (remote URLs optionally supported via --url and --admin)
npx wishboard db reset-rules
```

#### Build Management

Manage build and offline fallback assets:

```bash
# Download fallback Google fonts for offline kiosk execution
npx wishboard build download-fonts
```

#### User Authentication & Tokens

Generate session tokens:

```bash
# Generate an authenticated session token for a user
npx wishboard auth token <username> --url <base_url>
```

## Notes

- The system is designed for a private Wi-Fi network and on-device deployment.

---
title: Forking and Bootstrapping Guide
---

Welcome to the Wishboard project! If you've forked this repository to deploy your own instance of Wishboard, this guide will walk you through setting up the external services, credentials, CI/CD secrets, AWS OIDC deployment roles, and databases.

## Quickstart: Automated Bootstrapping (Recommended)

Wishboard includes a unified `bootstrap` CLI command that provisions external services and configures GitHub secrets/variables in a single interactive or scripted invocation:

```bash
npx wishboard bootstrap \
  --sonar-token <token> \
  --stryker-key <key> \
  --gitleaks-license <license> \
  --turso-db <db-name>
```

### What `bootstrap` automates:

1. **CI/CD Quality & Security Secrets**: Configures `SONAR_TOKEN`, `STRYKER_DASHBOARD_API_KEY`, and `GITLEAKS_LICENSE` (sharing with Dependabot automatically to keep automated dependency PRs green).
2. **AWS OIDC Deployment Role**: Deploys the CloudFormation stack in `aws-serverless/github-oidc-role.yaml` to create an OpenID Connect IAM role and configures `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, and `AWS_STACK_NAME`.
3. **Database & SSM Parameter Store**: Uses the `turso` CLI to create or retrieve a libSQL/Turso database and auth token, stores the token as an encrypted `SecureString` in AWS SSM (`/<repo>/<profile>/database-auth-token`), and configures `DATABASE_URL` and `DATABASE_AUTH_TOKEN_SSM` repository variables.

### Common Options:

- `--org <name>` and `--repo <name>`: GitHub repository (auto-detected from git remote or `package.json`).
- `--region <name>`: Target AWS region (defaults to `us-east-1`).
- `--event-profile <name>`: Profile prefix for variables and SSM paths (e.g. `lifestyle`, `professional`).
- `--skip-secrets`: Skip configuring SonarCloud, Stryker, and Gitleaks secrets.
- `--skip-oidc`: Skip provisioning the AWS OIDC deployment role.
- `--skip-db`: Skip Turso database provisioning and AWS SSM parameter registration.
- `--dry-run`: Preview all CloudFormation, AWS SSM, and GitHub CLI operations without making changes.

---

## Manual Service Configuration

Wishboard uses several external services to maintain code quality. To make the CI pipeline pass in your fork, you will need to set up the following:

### SonarCloud (Static Analysis)

1. Go to [SonarCloud](https://sonarcloud.io/) and log in with your GitHub account.
2. Import your forked repository.
3. Generate a SonarCloud token.
4. Add the token as a Repository Secret named `SONAR_TOKEN` in your GitHub repository (`Settings > Secrets and variables > Actions`).

### Stryker (Mutation Testing Dashboard)

1. Go to [Stryker Dashboard](https://dashboard.stryker-mutator.io/) and log in.
2. Enable your repository to get an API key.
3. Add the API key as a Repository Secret named `STRYKER_DASHBOARD_API_KEY`.

### Gitleaks (Secret Scanning)

Wishboard uses Gitleaks to prevent secrets from being committed.

1. If your fork belongs to a GitHub Organization (rather than a personal account), Gitleaks requires a license.
2. Get a free open-source license from [Gitleaks](https://gitleaks.io/products.html).
3. Add the license as a Repository Secret named `GITLEAKS_LICENSE`.
4. **Important for Dependabot**: You must explicitly share the secret with Dependabot to prevent dependency update PRs from failing. Use the GitHub CLI:
   ```bash
   gh secret set GITLEAKS_LICENSE --body "your-license-key" --app dependabot
   ```

## 2. Serverless Cloud Deployment (AWS)

If you plan to deploy the serverless stack to AWS, you must configure GitHub Actions to authenticate with your AWS account using OIDC (OpenID Connect). We provide an automated CLI tool to handle this.

1. Ensure you have the [AWS CLI](https://aws.amazon.com/cli/) installed and authenticated locally with administrative permissions.
2. From the root of the repository, run the CLI tool:
   ```bash
   npx wishboard oidc setup
   ```
3. The tool will automatically provision an IAM role and identity provider in AWS, and it will configure the necessary `AWS_ROLE_TO_ASSUME` secret and `AWS_REGION` variable in your GitHub repository.

## 3. Local Hardware Deployment (Kiosk SSH)

If you are deploying Wishboard to local hardware (like a Raspberry Pi), you need to configure passwordless SSH for the deployment script.

1. Ensure the target user on the device is in the `sudoers` list.
2. Generate an SSH key on your deployment machine if you don't have one:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```
3. Copy the public key to the target device:
   ```bash
   ssh-copy-id user@device_ip
   ```
4. Deploy using the unified CLI:
   ```bash
   npx wishboard kiosk deploy --user <user> --host <device_ip>
   ```

## 4. Optional AI Integration Configuration

AI features are entirely optional and require **zero external setup by default** (`ENABLE_AI_FEATURES=false`, $0.00/mo). If you wish to activate AI tag suggestions and semantic search on your fork:

- **Local Kiosks / Offline**: Set `ENABLE_AI_FEATURES=true` and `AI_PROVIDER=local` in your kiosk `.env`. This runs offline taxonomy heuristics and feature-hashing embeddings on the CPU with zero external API calls or costs.
- **Cloud / Serverless**: Set `ENABLE_AI_FEATURES=true`, `AI_PROVIDER=cloud`, and configure `AI_API_KEY` (e.g. using Google AI Studio / Gemini API free tier) in your Lambda environment variables or AWS SSM. See the [Optional AI Features & Semantic Search Guide](../ai-features/) for complete details.

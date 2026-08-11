---
title: Forking and Bootstrapping Guide
---

Welcome to the Wishboard project! If you've forked this repository to deploy your own instance of Wishboard, this guide will walk you through the external services and credentials you need to set up for the CI/CD pipelines to pass and deployments to succeed.

## 1. External Quality & Security Scanners

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
   npm install
   node src/cli/wishboard.js deploy oidc
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
4. Update the inventory file or deployment scripts to point to your specific IP and user.

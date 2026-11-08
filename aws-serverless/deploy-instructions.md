# Deploying Wishboard to AWS Serverless

This guide details how to build, deploy, maintain, and estimate the monthly costs of running Wishboard as a serverless application on AWS.

---

## AWS Monthly Cost & Pricing Analysis

Here is a monthly cost breakdown for a moderate-use environment (e.g., 5,000 active monthly users, 10,000 API requests, and 1 GB of image uploads):

| Service                    | Estimated Monthly Usage                               | Free Tier Covered?                                                    | Estimated Monthly Cost                  |
| :------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------- | :-------------------------------------- |
| **Amazon CloudFront**      | 10,000 HTTP requests, <10 GB egress data              | Yes (covered by permanent 1 TB egress / 10M requests)                 | **$0.00**                               |
| **Amazon S3**              | 1 GB storage, 10,000 GETs, 1,000 PUTs                 | Yes (covered by 5 GB / 20k GET / 2k PUT Free Tier)                    | **$0.00** (or **$0.03** post-Free Tier) |
| **AWS Lambda**             | 10,000 invocations (avg. 500ms execution, 512MB RAM)  | Yes (covered by permanent 1M requests / 400k GB-sec)                  | **$0.00**                               |
| **Amazon API Gateway**     | 10,000 HTTP API requests, 1,000 WebSocket connections | HTTP API: $0.01. WebSockets: $0.01.                                   | **$0.02**                               |
| **Turso (hosted libSQL)**  | 1 DB, a few MB, low read/write volume                 | Yes — sits >100× under the free tier (5 GB / 500M reads / 10M writes) | **$0.00**                               |
| **Route 53 & ACM**         | 1 Hosted Zone, 1 ACM certificate, low DNS queries     | ACM: Free. Route 53 Hosted Zone: $0.50.                               | **$0.50**                               |
| **Total (Free Tier)**      |                                                       |                                                                       | **$0.52 / month**                       |
| **Total (Post-Free Tier)** |                                                       |                                                                       | **$0.55 / month**                       |

> [!NOTE]
> **No VPC, by design.** Earlier revisions ran the Lambdas in a VPC to reach a SQLite database on EFS, using a free S3 Gateway Endpoint to dodge a NAT Gateway. But that topology still ran **CloudWatch + CloudWatch Logs interface endpoints at ~$0.01/hr each (~$1/day)** — a line this table originally omitted. Moving the database to **Turso** (reachable over the public internet) removed the reason for the VPC entirely: no VPC, no EFS, no interface endpoints — and, as a bonus, server→client WebSockets now work, because a VPC-less Lambda can reach `execute-api`. See [ADR 0002](../docs/src/content/docs/adr/0002-serverless-database-architecture.md) and [ADR 0003](../docs/src/content/docs/adr/0003-serverless-realtime-websockets.md).

---

## Prerequisites

Before starting, make sure you have the following installed and configured on your machine:

1. **AWS CLI** (configured with admin credentials to your AWS account).
2. **AWS SAM CLI** (Serverless Application Model CLI) to build and deploy.
3. **Node.js** (v24+) and **npm**.
4. **Vite** (already configured in the project).
5. **Route 53 Hosted Zone ID** (Optional, if you wish to use a custom domain).
6. **A Turso database** and its auth token stored in SSM — see **[Database (Turso)](#database-turso)** below.

---

## Database (Turso)

The serverless stack uses a hosted **[Turso](https://turso.tech)** (libSQL) database — there is **no VPC and no EFS**. Set this up once per environment before deploying:

1. **Create the database**, co-located with the stack's region for low latency (`iad` = `us-east-1`):

   ```bash
   turso group create wishboard-us --location iad   # once per org, if you have no US group
   turso db create wishboard --group wishboard-us
   turso db show wishboard --url                     # -> the DatabaseUrl (libsql://…)
   ```

2. **Mint an auth token and store it in SSM** (SecureString). The Lambda reads it at cold start; it never lives in the template, the deploy command, or CI:

   ```bash
   turso db tokens create wishboard
   npx wishboard db set-ssm-token /wishboard/dev/turso-auth-token "<token>" --region us-east-1
   # (Or directly via AWS CLI):
   # aws ssm put-parameter --name /wishboard/dev/turso-auth-token --type SecureString --value "<token>" --overwrite --region us-east-1
   ```

3. Pass the **URL** and the **SSM parameter name** to the deploy as the `DatabaseUrl` and `DatabaseAuthTokenSsm` parameters — via `sam --guided`, `samconfig.toml` (local; gitignored), or the `DATABASE_URL` / `DATABASE_AUTH_TOKEN_SSM` repository **Variables** (CI).

### Rotating the token

Turso tokens are all valid concurrently, but there is **no per-token revoke** — `turso db tokens invalidate` rotates the database's signing key and kills _every_ token at once.

- **Proactive roll (no leak):** `turso db tokens create`, then `aws ssm put-parameter --overwrite` the new value. New Lambda cold starts pick it up; warm ones keep working on the old (still-valid) token — zero downtime.
- **Compromise:** `turso db tokens invalidate` (kills all) → `turso db tokens create` → put the fresh token in SSM → force new cold starts (redeploy). Brief window while it propagates.

---

## Quick Deploy (Scripted)

The fastest path to manual deployment is using the bundled deploy scripts. However, for a fully automated CI/CD pipeline, you can use the **GitHub Actions Deployment** workflow.

### GitHub Actions Release & Deployment Pipeline (Recommended)

Wishboard features automated serverless deployment triggered on **official release creation** (via `release-please`):

1. **Automatic Release Deployment**:
   When a release PR is merged into `main`, GitHub Actions automatically deploys two production stacks concurrently:
   - **Lifestyle Profile**: `demo.wishboards.app` (uses standard repository variables: `DOMAIN_NAME`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN_SSM`, `AWS_STACK_NAME`).
   - **Professional Profile**: `conference.wishboards.app` (uses professional overrides: `PROFESSIONAL_DOMAIN_NAME`, `PROFESSIONAL_DATABASE_URL`, `PROFESSIONAL_DATABASE_AUTH_TOKEN_SSM`, `PROFESSIONAL_AWS_STACK_NAME`, `PROFESSIONAL_ACM_CERTIFICATE_ARN`).

2. **Repository Variables Configuration**:
   Configure GitHub Repository Variables to customize deployments:
   - Standard / Lifestyle Stack: `DATABASE_URL`, `DATABASE_AUTH_TOKEN_SSM`, `DOMAIN_NAME` (`demo.wishboards.app`), `AWS_STACK_NAME`.
   - Professional Stack Overrides: `PROFESSIONAL_DATABASE_URL`, `PROFESSIONAL_DATABASE_AUTH_TOKEN_SSM`, `PROFESSIONAL_DOMAIN_NAME` (`conference.wishboards.app`), `PROFESSIONAL_AWS_STACK_NAME`, `PROFESSIONAL_ACM_CERTIFICATE_ARN`.

3. **Manual Triggering (Workflow Dispatch)**:
   You can also manually trigger `Deploy Serverless` from the GitHub Actions tab, selecting the target `event_profile` (`lifestyle` or `professional`) and mode (`prod` or `dev`).

### Local CLI Deployment

If you prefer to deploy locally, use the unified CLI, which executes every step in order (frontend build → `sam build` → native-binary post-build → `sam deploy` → S3 upload → CloudFront invalidation). The first run walks you through interactive SAM configuration; subsequent runs reuse it. Works identically on macOS, Linux, and Windows.

```bash
npx wishboard serverless deploy --profile wishboard      # or omit --profile for default creds
```

Useful flags: `--guided` (force first-time config), `--mode` (deploy as `prod` or `dev`),
`--frontend-only` (rebuild + reupload the UI without touching the backend),
`--skip-frontend-upload`, `--stack-name`, `--region`, and `--dry-run` to preview commands.

To run the steps manually instead, follow the sections below.

## Deployment Steps

### 1. Build the Frontend

Compile the React frontend static assets:

```bash
npm run build
```

This output is saved to the `./dist` directory.

### 2. Build the Serverless Backend

We use AWS SAM's native `esbuild` support to bundle the backend Express code and the WebSocket manager:

```bash
cd aws-serverless
sam build
```

Then copy the libSQL native binary into the build artifacts. esbuild bundles the
JavaScript layer of `@libsql/client`, but the native `.node` binding cannot be
bundled, so it must be added to the artifact after `sam build`. Skipping this
step makes every API call fail with HTTP 500 (`Cannot find module
'@libsql/linux-x64-gnu'`):

```bash
node post-build.js
```

### 3. Deploy the Stack

Deploy the resources to your AWS account. If deploying a custom domain, we recommend deploying this stack in the **us-east-1** (N. Virginia) region so ACM can automatically provision the SSL/TLS certificate:

```bash
sam deploy --guided
```

SAM will prompt you for the following parameters:

- **Stack Name**: `wishboard-serverless`
- **AWS Region**: `us-east-1` (highly recommended for custom domains)
- **DomainName**: Your custom domain (e.g. `wishboard.yourdomain.com`). Leave empty to use the default CloudFront URL. Also passed to the API Lambda as `WISHBOARD_DOMAIN` and served at runtime via `/api/config` (used by the poster); when empty, the client falls back to the host it's viewed on.
- **HostedZoneId**: The Route 53 Hosted Zone ID for domain verification. Leave empty if not using a custom domain.
- **AcmCertificateArn**: If you already have an SSL certificate in `us-east-1`, paste its ARN here.
- **DatabaseUrl**: Your Turso database URL (`libsql://<db>-<org>.aws-us-east-1.turso.io`). Not a secret. See **[Database (Turso)](#database-turso)** below.
- **DatabaseAuthTokenSsm**: The name of the SSM SecureString parameter holding the Turso auth token (e.g. `/wishboard/dev/turso-auth-token`). The token itself is never passed here.

Once deployment finishes, it will print the S3 bucket names and the CloudFront URL in the command output (e.g., `FrontendBucketName` and `CloudFrontUrl`).

### 3b. Enable CloudFront Additional Metrics (one-time, post-deploy)

The admin metrics dashboard uses enhanced CloudFront metrics (cache hit rate, origin latency, per-status error rates). These cannot be enabled inside the SAM template due to a CloudFormation circular dependency, so run this once after the first deploy:

```bash
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name wishboard-serverless \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

aws cloudfront create-monitoring-subscription \
  --distribution-id "$DIST_ID" \
  --monitoring-subscription '{"RealtimeMetricsSubscriptionConfig":{"RealtimeMetricsSubscriptionStatus":"Enabled"}}'
```

This is a global setting (~$1/distribution/month) and only needs to be run once — it persists across stack updates.

### 4. Upload Frontend Assets to S3

Upload the built React frontend files to the S3 bucket:

```bash
aws s3 sync ../dist s3://<Your-Frontend-Bucket-Name> --delete
```

_(Replace `<Your-Frontend-Bucket-Name>` with the value printed in the CloudFormation output)._

---

## Maintenance & Updates

### Updating the Backend (Express API / WebSockets)

If you modify any files in `src/server/*`:

1. Re-build the stack:
   ```bash
   sam build
   ```
2. Deploy the updates:
   ```bash
   sam deploy
   ```

### Updating the Frontend (React UI)

If you modify any frontend files:

1. Re-build the static assets:
   ```bash
   npm run build
   ```
2. Upload the updated files to S3:
   ```bash
   aws s3 sync ../dist s3://<Your-Frontend-Bucket-Name> --delete
   ```
3. Invalidate the CloudFront cache to make the changes live immediately:
   ```bash
   aws cloudfront create-invalidation --distribution-id <Your-CloudFront-Distribution-Id> --paths "/*"
   ```

---

## Accessing the Application

- Access your board at the custom domain URL (if configured) or the default CloudFront URL (e.g. `https://dxxxxxxxxxxxxx.cloudfront.net`).
- File uploads are securely and automatically uploaded to S3 and served directly via CloudFront at `/images/*`.
- WebSockets operate seamlessly at `/socket.io/*` using API Gateway WebSockets, with connection states persisted automatically in the `websocket_connections` table in Turso. See [ADR 0003](../docs/adr/0003-serverless-realtime-websockets.md).

---

## Uninstalling / Teardown

If you want to completely remove Wishboard from your AWS account to stop incurring charges, you must tear down the stack. CloudFormation will fail to delete S3 buckets if they contain data, so the CLI automates emptying the buckets before deletion.

> [!WARNING]
> This action is permanent. All uploaded images and database records will be permanently deleted. **A `--force` flag is required when deleting a production (non-dev) stack.**

1. **Destroy the Application Stack:**

   ```bash
   npx wishboard serverless destroy --force
   ```

2. **Destroy the OIDC Deployment Role (Optional):**
   ```bash
   npx wishboard oidc destroy
   ```

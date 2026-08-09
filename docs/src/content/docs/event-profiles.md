---\ntitle: Event Profiles\n---\n# Event Profiles and Deployment Guide in Wishboard

The Wishboard project supports deploying customized event profiles (such as a professional conference or a lifestyle convention) across local kiosks or serverless AWS stacks.

## 1. Event Profiles

Profiles live in the `/profiles/` directory:

- `lifestyle`: Features lifestyle identities, sticker badges, and FetLife / Phone / Email contact methods.
- `professional`: Features conference roles, goal cross-matching rules (Hiring <-> Job Seeking), and LinkedIn / Phone / Email contact methods.

### Profile Directory Structure

Each profile is a directory containing separate YAML files for each concern:

```
profiles/<name>/
├── profile.yaml        # Required: core identity (profile name, contact methods, categories)
├── rules.yaml          # Matching rules (enrichment, acceptance, expansion, cross_match, exclusion)
├── stickers.yaml       # Visual identity sticker definitions
├── demo_seeds.yaml     # Demo seeder data (Mad Libs text fragments, optional user/wish counts)
├── theme.css           # Theme styling overrides
└── assets/             # Static assets (images, icons)
```

| File              | Required | Purpose                                                                              |
| ----------------- | -------- | ------------------------------------------------------------------------------------ |
| `profile.yaml`    | **Yes**  | Profile name, `contact_methods`, and `categories` (identity schema with suggestions) |
| `rules.yaml`      | No       | Matching engine rules — see [MATCHING_RULES.md](MATCHING_RULES.md)                   |
| `stickers.yaml`   | No       | Visual sticker badge definitions keyed by category/value                             |
| `demo_seeds.yaml` | No       | Mad Libs fragments for the demo seeder — see [Demo Seeder](#demo-seeder) below       |
| `theme.css`       | No       | CSS custom properties to theme the frontend                                          |

> **Backward compatibility**: A monolithic `profile.yaml` containing inline `rules`, `stickers`, or `demo_seeds` keys still works. If a separate file (e.g., `rules.yaml`) also exists, it takes precedence and a warning is logged.

### Creating a New Profile

To create a custom profile for your own event:

1. Create a new directory under `profiles/`, e.g., `profiles/gaming/`.
2. Add a `profile.yaml` with at minimum:
   ```yaml
   profile: gaming
   contact_methods:
     - Discord
     - Email
   categories:
     - id: platform
       label: Platform
       suggestions:
         - PC
         - PlayStation
         - Xbox
         - Nintendo
     - id: genre
       label: Genre
       suggestions:
         - FPS
         - RPG
         - Strategy
         - Simulation
   ```
3. Optionally add `rules.yaml`, `stickers.yaml`, `demo_seeds.yaml`, and `theme.css`.
4. Deploy with `--event-profile gaming`.

### Demo Seeder

The admin panel includes a demo seeder to populate simulated users and wishes for development and testing. The seeder generates wish text using a "Mad Libs" approach, combining random fragments from three arrays.

Demo seed data lives in `demo_seeds.yaml` in the profile directory:

```yaml
# Optional: override the default counts (50 users, 100 wishes)
# user_count: 25
# wish_count: 50
actions:
  - 'I wish to find someone to collaborate on'
  - 'I wish to connect with people interested in'
subjects:
  - 'competitive Smash Bros tournaments'
  - 'indie game development'
contexts:
  - 'at this event.'
  - 'over voice chat after the con.'
```

| Key          | Required | Default | Description                         |
| ------------ | -------- | ------- | ----------------------------------- |
| `actions`    | **Yes**  | —       | Opening phrases for wish text       |
| `subjects`   | **Yes**  | —       | Topics/activities to wish about     |
| `contexts`   | **Yes**  | —       | Closing context/setting phrases     |
| `user_count` | No       | `50`    | Number of demo users to generate    |
| `wish_count` | No       | `100`   | Number of demo wishes to distribute |

**When `demo_seeds.yaml` is absent**, the demo seeder is disabled: the admin UI hides the "Run Seeder" button and displays instructions on how to add demo seeds.

### Selecting a Profile during Deployment

To specify an event profile, use the `--event-profile` flag:

```bash
# Serverless deployment for a professional conference
npx wishboard serverless deploy --stack-name conf-wishboard --event-profile professional

# Kiosk deployment for a professional conference
npx wishboard kiosk deploy --event-profile professional
```

If `--event-profile` points to a non-existent profile name, the deployment script aborts with an error before making changes.

## 2. Deploying to Different Stacks

To deploy an isolated instance of Wishboard on AWS, assign it a unique CloudFormation stack name:

```bash
npx wishboard serverless deploy --stack-name conf-wishboard --event-profile professional
```

Each unique stack name creates an isolated set of AWS resources (Lambda functions, API Gateway, S3 buckets, and CloudFront distributions).

## 3. Configuring Domains and Wildcard Certificates

You can override the custom domain using `--domain` and `--cert-domain`:

```bash
npx wishboard serverless deploy \
  --stack-name conf-wishboard \
  --event-profile professional \
  --domain conference.wishboards.app \
  --cert-domain wishboards.app
```

## 4. Environment Profiles in SAM Config (`samconfig.toml`)

AWS SAM configuration (`aws-serverless/samconfig.toml`) supports section-based environment profiles (e.g. `default`, `lifestyle`, `professional`).

Profile parameters inherit from `default.deploy.parameters` or `default.global.parameters`, so environment-specific sections only need to override profile-specific parameters (such as `stack_name`, `parameter_overrides` for `DomainName`, `DatabaseUrl`, and `DatabaseAuthTokenSsm`):

```toml
[default.deploy.parameters]
stack_name = "wishboard-serverless-dev"
region = "us-east-1"
profile = "wishboard"

[lifestyle.deploy.parameters]
parameter_overrides = 'ProjectName="wishboard-serverless" DomainName="lifestyle.wishboards.app" HostedZoneId="Z0123456789ABCDEF" DatabaseUrl="libsql://wishboard-dev.turso.io" DatabaseAuthTokenSsm="/wishboard/dev/turso-auth-token"'

[professional.deploy.parameters]
stack_name = "wishboard-serverless-conference-dev"
parameter_overrides = 'ProjectName="wishboard-serverless" DomainName="conference.wishboards.app" HostedZoneId="Z0123456789ABCDEF" DatabaseUrl="libsql://conference-dev.turso.io" DatabaseAuthTokenSsm="/wishboard/conf/turso-auth-token"'
```

When deploying with `--event-profile <name>` (or `--config-env <name>`), the CLI automatically:

- Passes `--config-env <name>` to `sam deploy`.
- Resolves stack configurations, parameter overrides, and region defaults from the matching `samconfig.toml` profile section with fallback to `default`.
- Reuses the ACM SSL Certificate created by the primary stack when a wildcard or apex domain certificate is present.

## 5. Alternative Turso Databases & SSM Token Seeding

To point a serverless deployment stack to an isolated database:

1. **Seed the auth token into AWS SSM Parameter Store** as a `SecureString`:
   ```bash
   npx wishboard db set-ssm-token /wishboard/conf/turso-auth-token "your-turso-jwt-token" --region us-east-1
   ```
2. **Deploy the serverless stack with the custom database variables**:
   ```bash
   DATABASE_URL="libsql://wishboard-conf-yourorg.turso.io" \
   DATABASE_AUTH_TOKEN_SSM="/wishboard/conf/turso-auth-token" \
   npx wishboard serverless deploy \
     --stack-name conf-wishboard \
     --event-profile professional \
     --domain conference.wishboards.app \
     --cert-domain wishboards.app
   ```

## 5. Kiosk Database Architecture

For local Raspberry Pi kiosk deployments (`npx wishboard kiosk deploy`), Wishboard runs an embedded libSQL server in a Docker container on the Pi (`DATABASE_URL=http://db:8080` inside the compose network, with SQLite files stored at `./data/db`). No remote authentication token or SSM parameter is required for standard kiosk deployments.

To connect a kiosk to a remote database instead, specify `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in `$WISHBOARD_HOME/wishboard/.env` on the Pi prior to starting the service.

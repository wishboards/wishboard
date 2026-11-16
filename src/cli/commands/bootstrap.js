import {
  hasCommand,
  getGitRepoInfo,
  execCommand,
  getEventProfile,
  setupAwsEnv,
} from '../commandUtils.js';
import { setupOidc, setGitHubRepoValue, checkGitHubAuth } from './oidc.js';
import { setSsmToken } from './db.js';

function logStep(msg) {
  console.log(`\x1b[36m==> ${msg}\x1b[0m`);
}

function logInfo(msg) {
  console.log(`    ${msg}`);
}

function logWarn(msg) {
  console.warn(`\x1b[33mWARNING: ${msg}\x1b[0m`);
}

function logError(msg) {
  console.error(`\x1b[31mERROR: ${msg}\x1b[0m`);
}

export function resolveRepoInfo(options = {}) {
  let { org, repo, region = 'us-east-1' } = options;

  if (!org || !repo) {
    const gitInfo = getGitRepoInfo();
    if (gitInfo) {
      org = org || gitInfo.org;
      repo = repo || gitInfo.repo;
    } else {
      throw new Error(
        'Could not detect GitHub repository from Git remote or package.json repository field. Please provide --org and --repo.'
      );
    }
  }

  return { org, repo, region };
}

/**
 * Provisions or retrieves a Turso database URL and authentication token.
 * If credentials are not explicitly supplied, attempts to use the `turso` CLI if available.
 */
export function provisionTursoDatabase(
  dbName,
  { databaseUrl, databaseAuthToken, dryRun = false } = {},
  deps = {}
) {
  const exec = deps.execCommand || execCommand;
  const has = deps.hasCommand || hasCommand;

  let url = databaseUrl || process.env.DATABASE_URL;
  let token = databaseAuthToken || process.env.DATABASE_AUTH_TOKEN;

  if (url && token) {
    return { url, token, provisioned: false };
  }

  if (has('turso')) {
    logInfo(`Turso CLI detected. Resolving database '${dbName}'...`);
    if (dryRun) {
      return {
        url: url || 'libsql://dry-run-db.turso.io',
        token: token || 'dry-run-turso-token',
        provisioned: true,
      };
    }

    if (!url) {
      const showRes = exec('turso', ['db', 'show', dbName, '--url'], { stdio: 'pipe' });
      if (showRes.status === 0 && showRes.stdout.trim()) {
        url = showRes.stdout.trim();
        logInfo(`Found existing Turso database: ${url}`);
      } else {
        logInfo(`Creating new Turso database '${dbName}'...`);
        const createRes = exec('turso', ['db', 'create', dbName], { stdio: 'pipe' });
        if (createRes.status !== 0) {
          throw new Error(`Failed to create Turso database '${dbName}': ${createRes.stderr}`);
        }
        const newUrlRes = exec('turso', ['db', 'show', dbName, '--url'], { stdio: 'pipe' });
        url = newUrlRes.stdout.trim();
        logInfo(`Created Turso database: ${url}`);
      }
    }

    if (!token) {
      logInfo(`Creating auth token for Turso database '${dbName}'...`);
      const tokenRes = exec('turso', ['db', 'tokens', 'create', dbName], { stdio: 'pipe' });
      if (tokenRes.status !== 0) {
        throw new Error(`Failed to generate Turso token for '${dbName}': ${tokenRes.stderr}`);
      }
      token = tokenRes.stdout.trim();
    }

    return { url, token, provisioned: true };
  }

  return { url: url || '', token: token || '', provisioned: false };
}

/**
 * Automates external site bootstrapping for forks:
 * 1. External CI/CD quality and security secrets (SonarCloud, Stryker, Gitleaks).
 * 2. AWS OIDC deployment role and GitHub repository variables.
 * 3. Turso database provisioning, SSM auth token registration, and GitHub variables.
 */
export async function runBootstrap(options = {}, deps = {}) {
  const dryRun = Boolean(options.dryRun);
  const { org, repo, region } = resolveRepoInfo(options);
  const eventProfile = getEventProfile(options);
  const profilePrefix = eventProfile.toUpperCase();

  setupAwsEnv({ region });

  console.log(`\n\x1b[32mWishboard Fork & Site Bootstrapper\x1b[0m`);
  logInfo(`Repository:    ${org}/${repo}`);
  logInfo(`AWS Region:    ${region}`);
  logInfo(`Event Profile: ${eventProfile}`);
  if (dryRun) logInfo(`Mode:          DRY RUN (no external resources will be created)\n`);
  else console.log('');

  const ghDetected = (deps.hasCommand || hasCommand)('gh');
  const ghAuthed = ghDetected && (deps.checkGitHubAuth || checkGitHubAuth)(dryRun);

  if (!ghAuthed) {
    logWarn(
      'GitHub CLI (gh) is not authenticated or not installed. Automatic secret registration will be skipped.'
    );
  }

  const setGh = deps.setGitHubRepoValue || setGitHubRepoValue;
  const configured = { secrets: [], variables: [] };

  // 1. External Quality & Security Scanners
  if (!options.skipSecrets) {
    logStep('[1/3] Configuring CI/CD quality and security secrets...');
    const sonarToken = options.sonarToken || process.env.SONAR_TOKEN;
    const strykerKey = options.strykerKey || process.env.STRYKER_DASHBOARD_API_KEY;
    const gitleaksLicense = options.gitleaksLicense || process.env.GITLEAKS_LICENSE;

    if (ghAuthed) {
      if (sonarToken) {
        if (setGh('secret', 'SONAR_TOKEN', sonarToken, dryRun)) {
          configured.secrets.push('SONAR_TOKEN');
        }
      } else {
        logInfo(
          'SONAR_TOKEN omitted (pass --sonar-token or set $SONAR_TOKEN to configure SonarCloud).'
        );
      }

      if (strykerKey) {
        if (setGh('secret', 'STRYKER_DASHBOARD_API_KEY', strykerKey, dryRun)) {
          configured.secrets.push('STRYKER_DASHBOARD_API_KEY');
        }
      } else {
        logInfo(
          'STRYKER_DASHBOARD_API_KEY omitted (pass --stryker-key or set $STRYKER_DASHBOARD_API_KEY to configure Stryker).'
        );
      }

      if (gitleaksLicense) {
        if (setGh('secret', 'GITLEAKS_LICENSE', gitleaksLicense, dryRun)) {
          configured.secrets.push('GITLEAKS_LICENSE');
        }
        // Share with Dependabot to avoid dependency scan PR failures
        setGh('secret', 'GITLEAKS_LICENSE', gitleaksLicense, dryRun, 'dependabot');
      } else {
        logInfo(
          'GITLEAKS_LICENSE omitted (pass --gitleaks-license or set $GITLEAKS_LICENSE if using an organization fork).'
        );
      }
    } else {
      logInfo('Skipping GitHub secret registration (gh not authenticated).');
    }
  } else {
    logStep('[1/3] Skipping CI/CD scanner secrets (--skip-secrets).');
  }

  // 2. AWS OIDC Role Provisioning
  if (!options.skipOidc) {
    logStep('[2/3] Provisioning AWS GitHub Actions OIDC deployment role...');
    try {
      const oidcSetupFn = deps.setupOidc || setupOidc;
      await oidcSetupFn({ org, repo, region, dryRun });
      configured.secrets.push('AWS_ROLE_TO_ASSUME');
      configured.variables.push('AWS_REGION', 'AWS_STACK_NAME');
    } catch (err) {
      logWarn(`AWS OIDC setup encountered an error: ${err.message}`);
    }
  } else {
    logStep('[2/3] Skipping AWS OIDC role provisioning (--skip-oidc).');
  }

  // 3. Turso Database & SSM SecureString Setup
  if (!options.skipDb) {
    logStep('[3/3] Setting up Turso database and AWS SSM parameter store...');
    const defaultDbName = `${repo}-${eventProfile}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const dbName = options.tursoDb || defaultDbName;
    const ssmParamName =
      options.databaseAuthTokenSsm || `/${repo}/${eventProfile}/database-auth-token`;

    try {
      const { url, token } = provisionTursoDatabase(
        dbName,
        {
          databaseUrl: options.databaseUrl,
          databaseAuthToken: options.databaseAuthToken,
          dryRun,
        },
        deps
      );

      if (token) {
        logInfo(`Storing database auth token in AWS SSM Parameter Store (${ssmParamName})...`);
        const ssmFn = deps.setSsmToken || setSsmToken;
        const ok = await ssmFn(ssmParamName, token, { region, dryRun }, logInfo, logError);
        if (ok) logInfo(`SSM parameter '${ssmParamName}' configured successfully.`);
      } else {
        logWarn(
          'No database auth token provided or generated. SSM token registration was skipped.'
        );
      }

      if (url && ghAuthed) {
        logInfo('Setting database variables in GitHub repository...');
        if (setGh('variable', 'DATABASE_URL', url, dryRun)) {
          configured.variables.push('DATABASE_URL');
        }
        if (setGh('variable', 'DATABASE_AUTH_TOKEN_SSM', ssmParamName, dryRun)) {
          configured.variables.push('DATABASE_AUTH_TOKEN_SSM');
        }
        if (eventProfile) {
          setGh('variable', `${profilePrefix}_DATABASE_URL`, url, dryRun);
          setGh('variable', `${profilePrefix}_DATABASE_AUTH_TOKEN_SSM`, ssmParamName, dryRun);
          configured.variables.push(
            `${profilePrefix}_DATABASE_URL`,
            `${profilePrefix}_DATABASE_AUTH_TOKEN_SSM`
          );
        }
      } else if (!url) {
        logInfo(
          'Database URL omitted (pass --database-url or install turso CLI to automatically provision a database).'
        );
      }
    } catch (err) {
      logWarn(`Database/SSM setup encountered an error: ${err.message}`);
    }
  } else {
    logStep('[3/3] Skipping Turso database and SSM setup (--skip-db).');
  }

  console.log('\n\x1b[32m=== Bootstrap Summary ===\x1b[0m');
  logInfo(
    `Configured Secrets:   ${configured.secrets.length > 0 ? configured.secrets.join(', ') : '(none)'}`
  );
  logInfo(
    `Configured Variables: ${configured.variables.length > 0 ? configured.variables.join(', ') : '(none)'}`
  );
  console.log('\n\x1b[32mNext Steps:\x1b[0m');
  logInfo(
    `Deploy your serverless stack: npx wishboard serverless deploy --event-profile ${eventProfile}`
  );
  logInfo(`Or deploy to a Raspberry Pi:  npx wishboard kiosk deploy --host raspberrypi.local\n`);
  return configured;
}

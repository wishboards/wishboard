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

function resolveOrCreateTursoUrl(dbName, exec) {
  const showRes = exec('turso', ['db', 'show', dbName, '--url'], { stdio: 'pipe' });
  if (showRes.status === 0 && showRes.stdout.trim()) {
    const existingUrl = showRes.stdout.trim();
    logInfo(`Found existing Turso database: ${existingUrl}`);
    return existingUrl;
  }

  logInfo(`Creating new Turso database '${dbName}'...`);
  const createRes = exec('turso', ['db', 'create', dbName], { stdio: 'pipe' });
  if (createRes.status !== 0) {
    throw new Error(`Failed to create Turso database '${dbName}': ${createRes.stderr}`);
  }
  const newUrlRes = exec('turso', ['db', 'show', dbName, '--url'], { stdio: 'pipe' });
  const createdUrl = newUrlRes.stdout.trim();
  logInfo(`Created Turso database: ${createdUrl}`);
  return createdUrl;
}

function createTursoAuthToken(dbName, exec) {
  logInfo(`Creating auth token for Turso database '${dbName}'...`);
  const tokenRes = exec('turso', ['db', 'tokens', 'create', dbName], { stdio: 'pipe' });
  if (tokenRes.status !== 0) {
    throw new Error(`Failed to generate Turso token for '${dbName}': ${tokenRes.stderr}`);
  }
  return tokenRes.stdout.trim();
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

  if (!has('turso')) {
    return { url: url || '', token: token || '', provisioned: false };
  }

  logInfo(`Turso CLI detected. Resolving database '${dbName}'...`);
  if (dryRun) {
    return {
      url: url || 'libsql://dry-run-db.turso.io',
      token: token || 'dry-run-turso-token',
      provisioned: true,
    };
  }

  if (!url) url = resolveOrCreateTursoUrl(dbName, exec);
  if (!token) token = createTursoAuthToken(dbName, exec);
  return { url, token, provisioned: true };
}

function registerOptionalGitHubSecret({ name, value, omittedMsg, dryRun, setGh, configured, app }) {
  if (!value) {
    logInfo(omittedMsg);
    return;
  }
  if (setGh('secret', name, value, dryRun)) {
    configured.secrets.push(name);
  }
  if (app) {
    setGh('secret', name, value, dryRun, app);
  }
}

function configureScannerSecretsStep({ options, dryRun, ghAuthed, setGh, configured }) {
  if (options.skipSecrets) {
    logStep('[1/4] Skipping CI/CD scanner secrets (--skip-secrets).');
    return;
  }
  logStep('[1/4] Configuring CI/CD quality and security secrets...');
  if (!ghAuthed) {
    logInfo('Skipping GitHub secret registration (gh not authenticated).');
    return;
  }

  registerOptionalGitHubSecret({
    name: 'SONAR_TOKEN',
    value: options.sonarToken || process.env.SONAR_TOKEN,
    omittedMsg:
      'SONAR_TOKEN omitted (pass --sonar-token or set $SONAR_TOKEN to configure SonarCloud).',
    dryRun,
    setGh,
    configured,
  });
  registerOptionalGitHubSecret({
    name: 'STRYKER_DASHBOARD_API_KEY',
    value: options.strykerKey || process.env.STRYKER_DASHBOARD_API_KEY,
    omittedMsg:
      'STRYKER_DASHBOARD_API_KEY omitted (pass --stryker-key or set $STRYKER_DASHBOARD_API_KEY to configure Stryker).',
    dryRun,
    setGh,
    configured,
  });
  registerOptionalGitHubSecret({
    name: 'GITLEAKS_LICENSE',
    value: options.gitleaksLicense || process.env.GITLEAKS_LICENSE,
    omittedMsg:
      'GITLEAKS_LICENSE omitted (pass --gitleaks-license or set $GITLEAKS_LICENSE if using an organization fork).',
    dryRun,
    setGh,
    configured,
    app: 'dependabot',
  });
}

async function provisionOidcStep({ options, deps, org, repo, region, dryRun, configured }) {
  if (options.skipOidc) {
    logStep('[2/4] Skipping AWS OIDC role provisioning (--skip-oidc).');
    return;
  }
  logStep('[2/4] Provisioning AWS GitHub Actions OIDC deployment role...');
  try {
    const oidcSetupFn = deps.setupOidc || setupOidc;
    await oidcSetupFn({ org, repo, region, dryRun });
    configured.secrets.push('AWS_ROLE_TO_ASSUME');
    configured.variables.push('AWS_REGION');
  } catch (err) {
    logWarn(`AWS OIDC setup encountered an error: ${err.message}`);
  }
}

async function provisionDatabaseStep({
  options,
  deps,
  repo,
  eventProfile,
  profilePrefix,
  region,
  dryRun,
  ghAuthed,
  setGh,
  configured,
}) {
  if (options.skipDb) {
    logStep('[3/4] Skipping Turso database and SSM setup (--skip-db).');
    return;
  }
  logStep('[3/4] Setting up Turso database and AWS SSM parameter store...');
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
      logWarn('No database auth token provided or generated. SSM token registration was skipped.');
    }

    if (url && ghAuthed) {
      logInfo('Setting database variables in GitHub repository...');
      if (setGh('variable', `${profilePrefix}_DATABASE_URL`, url, dryRun)) {
        configured.variables.push(`${profilePrefix}_DATABASE_URL`);
      }
      if (setGh('variable', `${profilePrefix}_DATABASE_AUTH_TOKEN_SSM`, ssmParamName, dryRun)) {
        configured.variables.push(`${profilePrefix}_DATABASE_AUTH_TOKEN_SSM`);
      }
    } else if (!url) {
      logInfo(
        'Database URL omitted (pass --database-url or install turso CLI to automatically provision a database).'
      );
    }
  } catch (err) {
    logWarn(`Database/SSM setup encountered an error: ${err.message}`);
  }
}

async function provisionAiStep({
  options,
  deps,
  repo,
  profilePrefix,
  region,
  dryRun,
  ghAuthed,
  setGh,
  configured,
}) {
  if (options.skipAi) {
    logStep('[4/4] Skipping AI setup (--skip-ai).');
    return;
  }
  const aiApiKey = options.aiApiKey || process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!aiApiKey) {
    logStep('[4/4] Skipping AI API key setup (no key provided).');
    logInfo(
      'AI API key omitted (pass --ai-api-key or set $AI_API_KEY / $GEMINI_API_KEY to configure serverless AI).'
    );
    return;
  }

  const aiApiKeySsm =
    options.aiApiKeySsm || process.env.AI_API_KEY_SSM || `/${repo}/ai/gemini-api-key`;
  const enableAi = options.enableAi !== undefined ? Boolean(options.enableAi) : true;
  const aiProvider = options.aiProvider || 'cloud';

  logStep('[4/4] Setting up AI API key in AWS SSM Parameter Store...');
  logInfo(`Storing AI API key in AWS SSM Parameter Store (${aiApiKeySsm})...`);
  const ssmFn = deps.setSsmToken || setSsmToken;
  const ok = await ssmFn(aiApiKeySsm, aiApiKey, { region, dryRun }, logInfo, logError);
  if (ok) {
    logInfo(`SSM parameter '${aiApiKeySsm}' configured successfully.`);
    configured.secrets.push('AI_API_KEY');
  }

  if (ghAuthed) {
    logInfo('Setting AI configuration variables in GitHub repository...');
    if (setGh('variable', `${profilePrefix}_AI_API_KEY_SSM`, aiApiKeySsm, dryRun)) {
      configured.variables.push(`${profilePrefix}_AI_API_KEY_SSM`);
    }
    if (setGh('variable', `${profilePrefix}_ENABLE_AI_FEATURES`, String(enableAi), dryRun)) {
      configured.variables.push(`${profilePrefix}_ENABLE_AI_FEATURES`);
    }
    if (setGh('variable', `${profilePrefix}_AI_PROVIDER`, aiProvider, dryRun)) {
      configured.variables.push(`${profilePrefix}_AI_PROVIDER`);
    }
  }
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

  configureScannerSecretsStep({ options, dryRun, ghAuthed, setGh, configured });
  await provisionOidcStep({ options, deps, org, repo, region, dryRun, configured });
  await provisionDatabaseStep({
    options,
    deps,
    repo,
    eventProfile,
    profilePrefix,
    region,
    dryRun,
    ghAuthed,
    setGh,
    configured,
  });
  await provisionAiStep({
    options,
    deps,
    repo,
    profilePrefix,
    region,
    dryRun,
    ghAuthed,
    setGh,
    configured,
  });

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

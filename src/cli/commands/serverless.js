import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCommand, execCommand, getEventProfile, setupAwsEnv } from '../commandUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SERVERLESS_DIR = path.join(PROJECT_ROOT, 'aws-serverless');
const SAM_CONFIG = path.join(SERVERLESS_DIR, 'samconfig.toml');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

function logStep(msg) {
  console.log(`\x1b[36m==> ${msg}\x1b[0m`);
}
function logInfo(msg) {
  console.log(`    ${msg}`);
}
function logError(msg) {
  console.error(`\x1b[31mERROR: ${msg}\x1b[0m`);
}

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reads a scalar value (e.g. stack_name, region, profile) from samconfig.toml for a given config environment. */
function readTomlValue(key, envName = 'default') {
  if (!fs.existsSync(SAM_CONFIG)) return '';
  const content = fs.readFileSync(SAM_CONFIG, 'utf8');

  const sections = [`${envName}.deploy.parameters`, `${envName}.global.parameters`];
  if (envName !== 'default') {
    sections.push('default.deploy.parameters', 'default.global.parameters');
  }
  sections.push('top_level');

  let currentSection = 'top_level';
  const valuesBySection = {};

  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)\]/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    const escapedKey = escapeRegExp(key);
    const match = new RegExp(String.raw`^\s*${escapedKey}\s*=\s*(.+?)\s*$`).exec(line);
    if (match && currentSection && !valuesBySection[currentSection]) {
      valuesBySection[currentSection] = match[1].trim().replace(/^"|"$/g, '');
    }
  }

  for (const sec of sections) {
    if (valuesBySection[sec]) {
      return valuesBySection[sec];
    }
  }

  return '';
}

/**
 * Extracts a key's value from a space-separated Key="Value" parameter_overrides
 * string. SAM writes samconfig.toml with *escaped* inner quotes
 * (`DomainName=\"demo.example.com\"`), so strip backslashes first — otherwise the
 * `Key="…"` match fails, the value resolves empty, and an empty override silently
 * tears down conditional resources (e.g. the custom domain). See #158.
 */
function getOverrideValue(key, overrides) {
  const normalized = overrides.replaceAll('\\', '');
  // Anchor on a token boundary so a shorter key can't match the tail of a longer
  // one (e.g. DomainName matching CustomDomainName="…" and resolving the wrong
  // value). parameter_overrides is a space-separated Key="Value" list, so the key
  // always starts the string or follows whitespace.
  const escapedKey = escapeRegExp(key);
  const regex = new RegExp(String.raw`(?<=\s|^)${escapedKey}="([^"]*)"`);
  const match = regex.exec(normalized);
  return match ? match[1] : '';
}

/**
 * Defense-in-depth against the #158 class of bug: if samconfig.toml clearly sets a
 * non-empty value for a param but we resolved it empty, refuse to deploy rather
 * than emit `Key=''` and delete the resources that value gates.
 */
function assertNotSilentlyBlanked(key, resolved, tomlOverrides) {
  const normalized = tomlOverrides.replaceAll('\\', '');
  const escapedKey = escapeRegExp(key);
  const regex = new RegExp(String.raw`(?<=\s|^)${escapedKey}="([^"]+)"`);
  const raw = regex.exec(normalized);
  if (raw && !resolved) {
    throw new Error(
      `${key} is set in samconfig.toml ("${raw[1]}") but resolved to empty. Refusing to deploy an ` +
        `empty ${key}, which would tear down dependent resources (e.g. the custom domain). ` +
        `This indicates a samconfig parsing bug — see #158.`
    );
  }
}

/** Resolves config with precedence: CLI options > samconfig.toml > defaults. */
function resolveConfig(options) {
  const configEnv =
    getEventProfile(options) || options?.configEnv || process.env.CONFIG_ENV || 'default';
  let { stackName, region, profile } = options;
  if (!stackName) stackName = readTomlValue('stack_name', configEnv);
  if (!stackName) stackName = 'wishboard-serverless';
  if (!region) region = readTomlValue('region', configEnv);
  if (!profile) profile = readTomlValue('profile', configEnv);
  return { stackName, region, profile, configEnv };
}

/** Builds the shared --profile/--region args for sam and aws invocations. */
function awsCommonArgs(profile, region) {
  const common = [];
  if (profile) common.push('--profile', profile);
  if (region) common.push('--region', region);
  return common;
}

/** Synchronous sleep so the retry loop can back off between attempts. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assertCommand(name) {
  if (!hasCommand(name)) {
    logError(`Required command '${name}' was not found in PATH. Please install it and retry.`);
    throw new Error(`${name} missing`);
  }
}

/** Verifies AWS credentials resolve; returns the account id. */
function verifyAwsAuth(common, dryRun) {
  if (dryRun) return 'MOCK_ACCOUNT_ID';
  const res = execCommand(
    'aws',
    ['sts', 'get-caller-identity', ...common, '--query', 'Account', '--output', 'text'],
    { stdio: 'pipe' }
  );
  const account = res.stdout.trim();
  if (res.status !== 0 || !account || account === 'None') {
    throw new Error('Unable to authenticate to AWS. Check your credentials / --profile value.');
  }
  return account;
}

/** Reads a single CloudFormation stack output value. */
function getStackOutput(stackName, common, key, dryRun) {
  if (dryRun) return `dry-run-${key}`;
  const res = execCommand(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      ...common,
      '--query',
      `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]`,
      '--output',
      'text',
    ],
    { stdio: 'pipe' }
  );
  if (res.status !== 0) {
    throw new Error(`Failed to read stack outputs for '${stackName}'.`);
  }
  const value = res.stdout.trim();
  return value === 'None' ? '' : value;
}

/**
 * Validates an externally-supplied CloudFormation parameter value. These flow
 * into a quoted string handed to `sam deploy --parameter-overrides`, so we
 * reject anything outside a conservative allowlist (letters, digits, and the
 * `. _ : / -` used by ARNs/domains/ids). This prevents a value from breaking out
 * of the quoting or injecting shell metacharacters — defense-in-depth, since
 * these are normally developer-supplied config.
 */
function assertSafeParam(name, value) {
  if (value && !/^[A-Za-z0-9._:/*-]+$/.test(value)) {
    throw new Error(
      `Invalid value for ${name}: only letters, digits, and ". _ : / * -" are allowed.`
    );
  }
  return value;
}

/**
 * Resolves a configuration value across CLI options, process.env, samconfig.toml overrides, and default fallbacks.
 * Precedence: CLI option > process.env > samconfig.toml override > default fallback.
 */
function resolveOverride(options, optionKey, envKey, tomlKey, overrides = '', fallback = '') {
  if (options?.[optionKey] !== undefined && options?.[optionKey] !== '') {
    return options[optionKey];
  }
  if (envKey && process.env[envKey] !== undefined && process.env[envKey] !== '') {
    return process.env[envKey];
  }
  if (tomlKey) {
    const val = getOverrideValue(tomlKey, overrides);
    if (val) return val;
  }
  return fallback;
}

/**
 * Resolves the active ProjectName based on CLI flags, environment, stack name, and samconfig.toml.
 */
function resolveProjectName(options = {}, mode = 'prod', tomlOverrides = '') {
  let projectName = options.projectName || process.env.PROJECT_NAME;
  if (!projectName) {
    if (options.stackName) {
      const suffix = options.stackName.replace(/^wishboard-serverless-?/, '').replace(/-dev$/, '');
      projectName = suffix ? `wishboard-${suffix}` : 'wishboard';
    } else {
      projectName = getOverrideValue('ProjectName', tomlOverrides) || 'wishboard';
    }
  }
  if (mode === 'dev' && !projectName.endsWith('-dev')) {
    projectName = `${projectName}-dev`;
  }
  return projectName;
}

/** Assembles the CloudFormation parameter override tokens for sam deploy. */
function buildParameterOverrides(options, mode) {
  const configEnv =
    getEventProfile(options) || options?.configEnv || process.env.CONFIG_ENV || 'default';
  const nodeEnv = mode === 'dev' ? 'development' : 'production';
  const tomlOverrides = readTomlValue('parameter_overrides', configEnv);

  const projectName = resolveProjectName(options, mode, tomlOverrides);
  const domainName = resolveOverride(options, 'domain', 'DOMAIN_NAME', 'DomainName', tomlOverrides);
  const certDomain = resolveOverride(
    options,
    'certDomain',
    'CERTIFICATE_DOMAIN_NAME',
    'CertificateDomainName',
    tomlOverrides
  );
  const hostedZoneId = resolveOverride(
    options,
    'hostedZoneId',
    'HOSTED_ZONE_ID',
    'HostedZoneId',
    tomlOverrides
  );
  const acmCertificateArn = resolveOverride(
    options,
    'acmCertArn',
    'ACM_CERTIFICATE_ARN',
    'AcmCertificateArn',
    tomlOverrides
  );
  const databaseUrl = resolveOverride(
    options,
    'databaseUrl',
    'DATABASE_URL',
    'DatabaseUrl',
    tomlOverrides
  );
  const databaseAuthTokenSsm = resolveOverride(
    options,
    'databaseAuthTokenSsm',
    'DATABASE_AUTH_TOKEN_SSM',
    'DatabaseAuthTokenSsm',
    tomlOverrides
  );

  assertSafeParam('ProjectName', projectName);
  assertSafeParam('DomainName', domainName);
  assertSafeParam('CertificateDomainName', certDomain);
  assertSafeParam('HostedZoneId', hostedZoneId);
  assertSafeParam('AcmCertificateArn', acmCertificateArn);
  assertSafeParam('DatabaseUrl', databaseUrl);
  assertSafeParam('DatabaseAuthTokenSsm', databaseAuthTokenSsm);

  // Never silently blank a param that samconfig explicitly sets (would delete the
  // custom domain / cert). An env override still wins; this only guards accidents.
  if (!options.domain && !process.env.DOMAIN_NAME)
    assertNotSilentlyBlanked('DomainName', domainName, tomlOverrides);
  if (!options.certDomain && !process.env.CERTIFICATE_DOMAIN_NAME)
    assertNotSilentlyBlanked('CertificateDomainName', certDomain, tomlOverrides);
  if (!options.hostedZoneId && !process.env.HOSTED_ZONE_ID)
    assertNotSilentlyBlanked('HostedZoneId', hostedZoneId, tomlOverrides);
  if (!options.acmCertArn && !process.env.ACM_CERTIFICATE_ARN)
    assertNotSilentlyBlanked('AcmCertificateArn', acmCertificateArn, tomlOverrides);
  // Blanking DatabaseUrl would silently fall the Lambda back to a (read-only)
  // local file path and crash the app, so guard it like the domain params.
  if (!process.env.DATABASE_URL)
    assertNotSilentlyBlanked('DatabaseUrl', databaseUrl, tomlOverrides);

  // Pass as a single space-separated string with quoted values. sam rejects a
  // bare empty token (e.g. `DomainName=`), so the optional domain params must be
  // quoted (`DomainName=''`) — CloudFormation then applies their empty defaults.
  return (
    `ProjectName='${projectName}' DomainName='${domainName}' ` +
    `CertificateDomainName='${certDomain}' ` +
    `HostedZoneId='${hostedZoneId}' AcmCertificateArn='${acmCertificateArn}' ` +
    `NodeEnv='${nodeEnv}' DatabaseUrl='${databaseUrl}' ` +
    `DatabaseAuthTokenSsm='${databaseAuthTokenSsm}'`
  );
}

/** Runs sam deploy, retrying transient upload failures for non-guided deploys. */
function runSamDeploy(deployArgs, guided, dryRun, sleepFn = sleepSync) {
  // Let boto retry transient S3/network errors while uploading artifacts.
  process.env.AWS_MAX_ATTEMPTS = '6';
  process.env.AWS_RETRY_MODE = 'adaptive';

  // Re-running sam deploy is idempotent (already-uploaded artifacts are
  // skipped), so retry to ride out flaky-network upload drops. Guided runs are
  // interactive, so never retry them.
  const maxAttempts = guided || dryRun ? 1 : 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = execCommand('sam', deployArgs, { cwd: SERVERLESS_DIR, dryRun });
    if (res.status === 0) return;
    if (attempt >= maxAttempts) {
      throw new Error(`sam deploy failed after ${attempt} attempt(s).`);
    }
    logInfo(
      `sam deploy attempt ${attempt} failed (exit ${res.status}); likely a transient upload error. Retrying in 5s...`
    );
    sleepFn(5000);
  }
}

/** Sets CLOUDFRONT_DISTRIBUTION_ID on the ApiFunction Lambda when it changed. */
function configureCloudFrontId(stackName, common, distId, dryRun) {
  logStep('Configuring CloudFront ID on ApiFunction environment variables...');
  try {
    const nameRes = execCommand(
      'aws',
      [
        'cloudformation',
        'describe-stack-resource',
        '--stack-name',
        stackName,
        '--logical-resource-id',
        'ApiFunction',
        ...common,
        '--query',
        'StackResourceDetail.PhysicalResourceId',
        '--output',
        'text',
      ],
      { stdio: 'pipe', dryRun }
    );
    const lambdaName = dryRun ? 'dry-run-api-fn' : nameRes.stdout.trim();
    if (!lambdaName || lambdaName === 'None') {
      throw new Error('Failed to resolve physical resource ID for ApiFunction');
    }

    if (dryRun) {
      execCommand(
        'aws',
        ['lambda', 'update-function-configuration', '--function-name', lambdaName, ...common],
        { dryRun }
      );
      return;
    }

    const cfgRes = execCommand(
      'aws',
      ['lambda', 'get-function-configuration', '--function-name', lambdaName, ...common],
      { stdio: 'pipe' }
    );
    if (cfgRes.status !== 0 || !cfgRes.stdout) {
      throw new Error('Failed to fetch Lambda function configuration');
    }
    const config = JSON.parse(cfgRes.stdout);
    const vars = config.Environment?.Variables ?? {};
    if (vars.CLOUDFRONT_DISTRIBUTION_ID === distId) {
      logInfo(`CLOUDFRONT_DISTRIBUTION_ID is already up to date (${distId})`);
      return;
    }
    vars.CLOUDFRONT_DISTRIBUTION_ID = distId;
    execCommand(
      'aws',
      [
        'lambda',
        'update-function-configuration',
        '--function-name',
        lambdaName,
        '--environment',
        JSON.stringify({ Variables: vars }),
        ...common,
      ],
      { stdio: 'pipe' }
    );
    logInfo(`Successfully configured CLOUDFRONT_DISTRIBUTION_ID=${distId} on ${lambdaName}`);
  } catch (err) {
    logInfo(
      `Warning: Could not dynamically set CLOUDFRONT_DISTRIBUTION_ID on Lambda: ${err.message}`
    );
  }
}

function performPreflightChecks(frontendOnly, common, dryRun) {
  logStep('Checking prerequisites...');
  assertCommand('node');
  assertCommand('npm');
  assertCommand('aws');
  if (!frontendOnly) assertCommand('sam');
  const account = verifyAwsAuth(common, dryRun);
  logInfo(`Authenticated to AWS account ${account}`);
}

function performBackendBuild(dryRun) {
  logStep('[2/6] Bundling backend (sam build)...');
  const samBuild = execCommand('sam', ['build'], { cwd: SERVERLESS_DIR, dryRun });
  if (samBuild.status !== 0) throw new Error('sam build failed.');

  logStep('[3/6] Copying libSQL native binary into artifacts (post-build.js)...');
  const postBuild = execCommand('node', ['post-build.js'], { cwd: SERVERLESS_DIR, dryRun });
  if (postBuild.status !== 0) throw new Error('post-build.js failed.');
}

function performStackDeploy(options, stackName, common, guided, mode, dryRun, sleepFn = sleepSync) {
  const configEnv =
    getEventProfile(options) || options?.configEnv || process.env.CONFIG_ENV || 'default';
  if (guided) {
    logStep('[4/6] Deploying stack (sam deploy --guided)...');
    logInfo('No samconfig.toml found or --guided specified; starting interactive setup.');
  } else {
    logStep('[4/6] Deploying stack (sam deploy)...');
  }

  const deployArgs = [
    'deploy',
    ...(configEnv && configEnv !== 'default' ? ['--config-env', configEnv] : []),
    '--stack-name',
    stackName,
    ...(guided
      ? ['--guided']
      : [
          '--no-confirm-changeset',
          '--no-fail-on-empty-changeset',
          '--capabilities',
          'CAPABILITY_IAM',
          '--resolve-s3',
        ]),
    ...common,
    '--parameter-overrides',
    buildParameterOverrides(options, mode),
    '--tags',
    'Project=wishboard',
  ];

  runSamDeploy(deployArgs, guided, dryRun, sleepFn);
}

function performFrontendUpload(frontendBucket, distId, common, dryRun) {
  if (!dryRun && !fs.existsSync(DIST_DIR)) {
    throw new Error(`Build output not found at ${DIST_DIR}.`);
  }
  logStep(`[6/6] Uploading frontend to s3://${frontendBucket} ...`);

  // First, upload all root files with no-cache and remove stale files (excluding assets and fonts)
  logInfo('Syncing root files (no-cache)...');
  const syncRoot = execCommand(
    'aws',
    [
      's3',
      'sync',
      DIST_DIR,
      `s3://${frontendBucket}`,
      '--exclude',
      'assets/*',
      '--exclude',
      'fonts/*',
      '--delete',
      '--cache-control',
      'no-cache, no-store, must-revalidate',
      ...common,
    ],
    { dryRun }
  );
  if (syncRoot.status !== 0) throw new Error('Frontend root files upload to S3 failed.');

  // Second, upload assets/ with long-lived immutable cache control
  logInfo('Syncing assets (immutable cache)...');
  const syncAssets = execCommand(
    'aws',
    [
      's3',
      'sync',
      path.join(DIST_DIR, 'assets'),
      `s3://${frontendBucket}/assets`,
      '--delete',
      '--cache-control',
      'public, max-age=31536000, immutable',
      ...common,
    ],
    { dryRun }
  );
  if (syncAssets.status !== 0) throw new Error('Frontend assets upload to S3 failed.');

  // Third, upload fonts/ with long-lived cache control
  const fontsDir = path.join(DIST_DIR, 'fonts');
  if (fs.existsSync(fontsDir)) {
    logInfo('Syncing fonts (cacheable)...');
    const syncFonts = execCommand(
      'aws',
      [
        's3',
        'sync',
        fontsDir,
        `s3://${frontendBucket}/fonts`,
        '--delete',
        '--cache-control',
        'public, max-age=31536000',
        ...common,
      ],
      { dryRun }
    );
    if (syncFonts.status !== 0) throw new Error('Frontend fonts upload to S3 failed.');
  }

  if (distId) {
    logInfo(`Invalidating CloudFront cache (${distId})...`);
    const inv = execCommand(
      'aws',
      [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        distId,
        '--paths',
        '/*',
        ...common,
      ],
      { stdio: 'pipe', dryRun }
    );
    if (inv.status !== 0) throw new Error('CloudFront invalidation failed.');
  }
}

function runBackendPipeline(options, stackName, region, profile, mode, common, dryRun) {
  // --- 2 & 3. Bundling & copy native binary ---
  performBackendBuild(dryRun);

  // --- 4. Deploy stack ---
  let guided = options.guided || !fs.existsSync(SAM_CONFIG);
  if (process.env.CI) guided = false;

  performStackDeploy(options, stackName, common, guided, mode, dryRun, options.sleep);

  // A guided deploy writes/updates samconfig.toml, so pick up the values the
  // user just chose. For a non-guided deploy samconfig is unchanged, and
  // re-reading it here would clobber an explicit --stack-name/--region/--profile
  // (deploying to one stack but reading outputs from another).
  if (guided) {
    if (!region) region = readTomlValue('region');
    if (!profile) profile = readTomlValue('profile');
    const tomlStack = readTomlValue('stack_name');
    if (tomlStack) stackName = tomlStack;
    common = awsCommonArgs(profile, region);
  }

  return { stackName, common };
}

function migrateImagesBucket(oldImagesBucket, imagesBucket, common, dryRun) {
  if (oldImagesBucket === imagesBucket) return;
  logStep(`Checking if old images bucket s3://${oldImagesBucket} exists...`);
  const checkOldImages = execCommand('aws', ['s3', 'ls', `s3://${oldImagesBucket}`, ...common], {
    stdio: 'pipe',
    dryRun,
  });
  if (dryRun || checkOldImages.status === 0) {
    logStep(
      `[Migration] Copying user images from s3://${oldImagesBucket} to s3://${imagesBucket}...`
    );
    execCommand(
      'aws',
      ['s3', 'sync', `s3://${oldImagesBucket}`, `s3://${imagesBucket}`, ...common],
      {
        stdio: 'inherit',
        dryRun,
      }
    );
    logStep(`[Migration] Emptying old images bucket s3://${oldImagesBucket}...`);
    execCommand('aws', ['s3', 'rm', `s3://${oldImagesBucket}`, '--recursive', ...common], {
      stdio: 'pipe',
      dryRun,
    });
    logStep(`[Migration] Deleting old images bucket s3://${oldImagesBucket}...`);
    execCommand('aws', ['s3', 'rb', `s3://${oldImagesBucket}`, ...common], {
      stdio: 'pipe',
      dryRun,
    });
  } else {
    logInfo('Old images bucket not found or already migrated.');
  }
}

function cleanupFrontendBucket(oldFrontendBucket, frontendBucket, common, dryRun) {
  if (oldFrontendBucket === frontendBucket) return;
  logStep(`Checking if old frontend bucket s3://${oldFrontendBucket} exists...`);
  const checkOldFrontend = execCommand(
    'aws',
    ['s3', 'ls', `s3://${oldFrontendBucket}`, ...common],
    {
      stdio: 'pipe',
      dryRun,
    }
  );
  if (dryRun || checkOldFrontend.status === 0) {
    logStep(`[Migration] Emptying old frontend bucket s3://${oldFrontendBucket}...`);
    execCommand('aws', ['s3', 'rm', `s3://${oldFrontendBucket}`, '--recursive', ...common], {
      stdio: 'pipe',
      dryRun,
    });
    logStep(`[Migration] Deleting old frontend bucket s3://${oldFrontendBucket}...`);
    execCommand('aws', ['s3', 'rb', `s3://${oldFrontendBucket}`, ...common], {
      stdio: 'pipe',
      dryRun,
    });
  } else {
    logInfo('Old frontend bucket not found or already migrated.');
  }
}

/**
 * Performs coordinated S3 migration when old-format regional buckets exist.
 */
function performCoordinatedS3Migration(
  common,
  mode,
  dryRun,
  imagesBucket,
  frontendBucket,
  options = {}
) {
  let accountId = '';
  try {
    accountId = verifyAwsAuth(common, dryRun);
  } catch (err) {
    logInfo(`Warning: Unable to resolve AWS Account ID for S3 migration: ${err.message}`);
  }

  if (accountId) {
    const tomlOverrides = readTomlValue('parameter_overrides');
    const projectName = resolveProjectName(options, mode, tomlOverrides);

    const oldFrontendBucket = `${projectName}-frontend-${accountId}`;
    const oldImagesBucket = `${projectName}-images-${accountId}`;

    migrateImagesBucket(oldImagesBucket, imagesBucket, common, dryRun);
    cleanupFrontendBucket(oldFrontendBucket, frontendBucket, common, dryRun);
  }
}

/**
 * Builds and deploys (or updates) the Wishboard AWS serverless stack.
 */
export function deployServerless(options) {
  const dryRun = !!options.dryRun;
  const mode = options.mode === 'dev' ? 'dev' : 'prod';
  const frontendOnly = !!options.frontendOnly;
  const skipFrontendUpload = !!options.skipFrontendUpload;

  const eventProfile = getEventProfile(options);
  const profileDir = path.resolve(PROJECT_ROOT, 'profiles', eventProfile);
  if (!dryRun && !process.env.VITEST && !fs.existsSync(profileDir)) {
    throw new Error(`Event profile '${eventProfile}' not found at ${profileDir}`);
  }
  process.env.EVENT_PROFILE = eventProfile;

  let { stackName, region, profile } = resolveConfig(options);
  setupAwsEnv({ profile, region });
  let common = awsCommonArgs(profile, region);

  console.log('\n\x1b[32mWishboard serverless deployment\x1b[0m');
  logInfo(`Stack:   ${stackName}`);
  logInfo(`Profile: ${profile || '(default credentials)'}`);
  logInfo(`Region:  ${region || '(from AWS config)'}`);
  console.log('');

  // --- Preflight ---
  performPreflightChecks(frontendOnly, common, dryRun);

  // --- 1. Frontend build ---
  logStep('[1/6] Building frontend (npm run build)...');
  const build = execCommand('npm', ['run', 'build'], { cwd: PROJECT_ROOT, dryRun });
  if (build.status !== 0) throw new Error('Frontend build failed.');

  if (!frontendOnly) {
    const updated = runBackendPipeline(options, stackName, region, profile, mode, common, dryRun);
    stackName = updated.stackName;
    common = updated.common;
  }

  // --- 5. Read stack outputs ---
  logStep('[5/6] Reading stack outputs...');
  const frontendBucket = getStackOutput(stackName, common, 'FrontendBucketName', dryRun);
  const imagesBucket = getStackOutput(stackName, common, 'ImagesBucketName', dryRun);
  const distId = getStackOutput(stackName, common, 'CloudFrontDistributionId', dryRun);
  const cfUrl = getStackOutput(stackName, common, 'CloudFrontUrl', dryRun);
  const customUrl = getStackOutput(stackName, common, 'CustomDomainUrl', dryRun);

  if (!frontendBucket) {
    throw new Error('FrontendBucketName output not found. Did the stack deploy successfully?');
  }
  if (!imagesBucket) {
    throw new Error('ImagesBucketName output not found. Did the stack deploy successfully?');
  }
  logInfo(`Frontend bucket: ${frontendBucket}`);
  logInfo(`Images bucket:   ${imagesBucket}`);

  // --- Coordinated S3 migration check ---
  performCoordinatedS3Migration(common, mode, dryRun, imagesBucket, frontendBucket, options);

  if (distId) {
    configureCloudFrontId(stackName, common, distId, dryRun);
  }

  // --- 6. Upload frontend + invalidate CloudFront ---
  if (skipFrontendUpload) {
    logStep('[6/6] Skipping frontend upload (--skip-frontend-upload).');
  } else {
    performFrontendUpload(frontendBucket, distId, common, dryRun);
  }

  console.log('\n\x1b[32mDeployment complete!\x1b[0m');
  if (cfUrl) console.log(`\x1b[32m  CloudFront URL: ${cfUrl}\x1b[0m`);
  if (customUrl) console.log(`\x1b[32m  Custom domain:  ${customUrl}\x1b[0m`);
  console.log('');
}

/**
 * Empties the stack's S3 buckets and tears down the CloudFormation stack.
 */
export function destroyServerless(options) {
  const dryRun = !!options.dryRun;
  const force = !!options.force;
  const { stackName, region, profile } = resolveConfig(options);
  setupAwsEnv({ profile, region });
  const common = awsCommonArgs(profile, region);

  // Guard production stacks against accidental data loss.
  if (!/dev/.test(stackName) && !force) {
    logError(
      `Attempting to delete a production stack '${stackName}'. Pass --force to acknowledge deletion of all images and databases.`
    );
    throw new Error('Refusing to delete production stack without --force');
  }

  assertCommand('aws');
  assertCommand('sam');

  logStep(`Checking for existing stack '${stackName}'...`);
  let stackStatus = '';
  if (!dryRun) {
    const res = execCommand(
      'aws',
      [
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        stackName,
        ...common,
        '--query',
        'Stacks[0].StackStatus',
        '--output',
        'text',
      ],
      { stdio: 'pipe' }
    );
    stackStatus = res.status === 0 ? res.stdout.trim() : '';
    if (!stackStatus || stackStatus === 'None') {
      logInfo(`Stack '${stackName}' does not exist or is already deleted.`);
      return;
    }
  }

  logStep(`Emptying S3 buckets for stack '${stackName}'...`);
  for (const key of ['FrontendBucketName', 'ImagesBucketName']) {
    const bucket = getStackOutput(stackName, common, key, dryRun);
    if (bucket && !bucket.startsWith('dry-run-')) {
      logInfo(`Emptying s3://${bucket}...`);
      execCommand('aws', ['s3', 'rm', `s3://${bucket}`, '--recursive', ...common], {
        stdio: 'pipe',
        dryRun,
      });
    } else if (dryRun) {
      logInfo(`[DRY RUN] Would empty S3 bucket resolved from output ${key}`);
    }
  }

  logStep(`Deleting CloudFormation stack '${stackName}'...`);
  const del = execCommand('sam', ['delete', '--stack-name', stackName, '--no-prompts', ...common], {
    dryRun,
  });
  if (del.status !== 0) throw new Error('sam delete failed.');

  console.log(`\n\x1b[32mSuccessfully destroyed serverless stack: ${stackName}\x1b[0m\n`);
}

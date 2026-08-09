import { hasCommand, getGitRepoInfo, execCommand } from '../commandUtils.js';

function logStep(msg) {
  console.log(`==> ${msg}`);
}

function logInfo(msg) {
  console.log(`    ${msg}`);
}

function logWarn(msg) {
  console.warn(`WARNING: ${msg}`);
}

function logError(msg) {
  console.error(`ERROR: ${msg}`);
}

/**
 * Resolves Org, Repo, and Region parameters.
 */
function resolveParams(options) {
  let { org, repo, region = 'us-east-1' } = options;

  if (!org || !repo) {
    const gitInfo = getGitRepoInfo();
    if (gitInfo) {
      org = org || gitInfo.org;
      repo = repo || gitInfo.repo;
      logInfo(`Detected GitHub repository from git remote: ${org}/${repo}`);
    } else {
      org = org || 'wishboards';
      repo = repo || 'wishboard';
      logWarn(`Could not detect GitHub repository from Git remote. Defaulting to ${org}/${repo}`);
    }
  }

  return { org, repo, region };
}

/**
 * Verifies that AWS CLI is installed and authentication is successful.
 * @returns {string} AWS Account ID
 */
function preflightChecks(dryRun) {
  logStep('Performing preflight checks...');
  if (!hasCommand('aws')) {
    logError('AWS CLI not found. Please install the AWS CLI.');
    throw new Error('AWS CLI missing');
  }

  if (dryRun) {
    return 'MOCK_ACCOUNT_ID';
  }

  const identityResult = execCommand(
    'aws',
    ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
    { stdio: 'pipe' }
  );
  if (identityResult.status !== 0) {
    logError('Unable to authenticate to AWS. Please run "aws configure" or log in first.');
    throw new Error('AWS authentication failed');
  }
  return identityResult.stdout.trim();
}

/**
 * Checks for existing stack/external OIDC provider configurations in IAM.
 * @returns {string} Oidc Provider ARN
 */
function resolveOidcProviderArn(stackName, dryRun) {
  logStep('Checking for existing GitHub OIDC Provider in AWS account...');
  if (dryRun) {
    return '';
  }

  let managedByStack = false;
  // Check if managed by CloudFormation stack
  const resDetail = execCommand(
    'aws',
    [
      'cloudformation',
      'describe-stack-resource',
      '--stack-name',
      stackName,
      '--logical-resource-id',
      'GithubOidcProvider',
      '--query',
      'StackResourceDetail.PhysicalResourceId',
      '--output',
      'text',
    ],
    { stdio: 'pipe' }
  );

  if (resDetail.status === 0 && resDetail.stdout && resDetail.stdout.trim() !== 'None') {
    managedByStack = true;
  }

  if (managedByStack) {
    logInfo('GitHub OIDC provider is managed by this stack. Keeping it.');
    return '';
  }

  // Check for external OIDC provider in IAM
  const oidcCheck = execCommand(
    'aws',
    [
      'iam',
      'list-open-id-connect-providers',
      '--query',
      "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]",
      '--output',
      'text',
    ],
    { stdio: 'pipe' }
  );

  const foundArn = oidcCheck.stdout.trim();
  if (foundArn && foundArn !== 'None') {
    logInfo(`Found existing external GitHub OIDC provider: ${foundArn}`);
    return foundArn;
  }

  logInfo('No existing GitHub OIDC provider found. It will be created.');
  return '';
}

/**
 * Runs the AWS CloudFormation deploy CLI command.
 */
function deployStack(stackName, org, repo, oidcArn, region, dryRun) {
  logStep(`Deploying CloudFormation stack: ${stackName}...`);
  const parameters = [`GitHubOrg=${org}`, `GitHubRepo=${repo}`, `OidcProviderArn=${oidcArn}`];

  const deployArgs = [
    'cloudformation',
    'deploy',
    '--template-file',
    'aws-serverless/github-oidc-role.yaml',
    '--stack-name',
    stackName,
    '--parameter-overrides',
    ...parameters,
    '--capabilities',
    'CAPABILITY_NAMED_IAM',
    '--region',
    region,
  ];

  const deployResult = execCommand('aws', deployArgs, { dryRun });
  if (deployResult.status !== 0) {
    logError('CloudFormation deployment failed.');
    throw new Error('CloudFormation deploy failed');
  }
}

/**
 * Retrieves the deployed Role ARN from CloudFormation stack outputs.
 */
function getDeployRoleArn(stackName, region, accountId, repo, dryRun) {
  logStep('Retrieving Role ARN output...');
  if (dryRun) {
    return `arn:aws:iam::${accountId}:role/${repo}-github-oidc-setup-Role`;
  }

  const describeResult = execCommand(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--query',
      "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue",
      '--output',
      'text',
      '--region',
      region,
    ],
    { stdio: 'pipe' }
  );

  if (
    describeResult.status === 0 &&
    describeResult.stdout &&
    describeResult.stdout.trim() !== 'None'
  ) {
    return describeResult.stdout.trim();
  }
  logError('Failed to retrieve RoleArn output from CloudFormation stack.');
  throw new Error('Failed to retrieve RoleArn');
}

/**
 * Prints instructions to configure repository settings manually on GitHub.
 */
function printManualInstructions(roleArn, region, repo) {
  console.log(
    '\x1b[33mPlease manually set the following in your GitHub Repository settings (Settings -> Secrets and variables -> Actions):\x1b[0m\n'
  );
  console.log('  \x1b[32mRepository Secrets:\x1b[0m');
  console.log(`    Name:  \x1b[36mAWS_ROLE_TO_ASSUME\x1b[0m`);
  console.log(`    Value: ${roleArn}\n`);
  console.log('  \x1b[32mRepository Variables:\x1b[0m');
  console.log(`    Name:  \x1b[36mAWS_REGION\x1b[0m`);
  console.log(`    Value: ${region}`);
  console.log(`    Name:  \x1b[36mAWS_STACK_NAME\x1b[0m`);
  console.log(`    Value: ${repo}-serverless-dev\n`);
}

/**
 * Checks if the GitHub CLI is authenticated.
 */
function checkGitHubAuth(dryRun) {
  if (dryRun) {
    return true;
  }
  const authCheck = execCommand('gh', ['auth', 'status'], { stdio: 'pipe' });
  return authCheck.status === 0;
}

/**
 * Helper to set a GitHub secret or variable.
 */
function setGitHubRepoValue(type, name, value, dryRun) {
  const res = execCommand('gh', [type, 'set', name, '--body', value], { dryRun });
  if (res.status === 0) {
    logInfo(`Set ${type}: ${name}`);
    return true;
  }
  logWarn(`Failed to set ${type} ${name} via GitHub CLI.`);
  return false;
}

/**
 * Populates GitHub Repository variables and secrets via GitHub CLI (gh).
 */
function configureGitHubSecrets(roleArn, region, repo, dryRun) {
  logStep('Configuring GitHub Repository settings...');

  if (!hasCommand('gh')) {
    logInfo('GitHub CLI (gh) not detected.');
    printManualInstructions(roleArn, region, repo);
    return;
  }

  if (!checkGitHubAuth(dryRun)) {
    logWarn(
      "GitHub CLI (gh) is installed but not authenticated. Run 'gh auth login' to authenticate."
    );
    printManualInstructions(roleArn, region, repo);
    return;
  }

  logInfo('GitHub CLI (gh) detected and authenticated. Configuring repository settings...');

  const s1 = setGitHubRepoValue('secret', 'AWS_ROLE_TO_ASSUME', roleArn, dryRun);
  const s2 = setGitHubRepoValue('variable', 'AWS_REGION', region, dryRun);
  const s3 = setGitHubRepoValue('variable', 'AWS_STACK_NAME', `${repo}-serverless-dev`, dryRun);

  if (!s1 || !s2 || !s3) {
    printManualInstructions(roleArn, region, repo);
  }
}

/**
 * Deploys GitHub Actions OIDC Authentication.
 */
export function setupOidc(options) {
  const { org, repo, region } = resolveParams(options);
  const dryRun = !!options.dryRun;

  const accountId = preflightChecks(dryRun);
  logInfo(`Authenticated to AWS Account: ${accountId}`);
  logInfo(`Target Deployment Region: ${region}`);

  const stackName = `${repo}-github-oidc-setup`;
  const oidcArn = resolveOidcProviderArn(stackName, dryRun);

  deployStack(stackName, org, repo, oidcArn, region, dryRun);

  const roleArn = getDeployRoleArn(stackName, region, accountId, repo, dryRun);
  logInfo('Deployment Role Created Successfully!');
  console.log(`\x1b[32mRole ARN: ${roleArn}\x1b[0m\n`);

  configureGitHubSecrets(roleArn, region, repo, dryRun);

  console.log('\x1b[32mOIDC Setup Complete!\x1b[0m');
}

/**
 * Tears down GitHub Actions OIDC Authentication.
 */
export function destroyOidc(options) {
  const { repo, region } = resolveParams(options);
  const dryRun = !!options.dryRun;

  const stackName = `${repo}-github-oidc-setup`;

  logStep(`Deleting CloudFormation stack: ${stackName}...`);
  execCommand(
    'aws',
    ['cloudformation', 'delete-stack', '--stack-name', stackName, '--region', region],
    { dryRun }
  );

  if (!dryRun) {
    execCommand('aws', [
      'cloudformation',
      'wait',
      'stack-delete-complete',
      '--stack-name',
      stackName,
      '--region',
      region,
    ]);
  }
  logInfo('Stack deleted successfully.');

  logStep('Cleaning up GitHub Repository settings...');

  if (hasCommand('gh')) {
    let ghAuth = false;
    if (dryRun) {
      ghAuth = true;
    } else {
      const authCheck = execCommand('gh', ['auth', 'status'], { stdio: 'pipe' });
      ghAuth = authCheck.status === 0;
    }

    if (ghAuth) {
      execCommand('gh', ['secret', 'delete', 'AWS_ROLE_TO_ASSUME'], { dryRun, stdio: 'ignore' });
      logInfo('Deleted secret: AWS_ROLE_TO_ASSUME');

      execCommand('gh', ['variable', 'delete', 'AWS_REGION'], { dryRun, stdio: 'ignore' });
      logInfo('Deleted variable: AWS_REGION');

      execCommand('gh', ['variable', 'delete', 'AWS_STACK_NAME'], { dryRun, stdio: 'ignore' });
      logInfo('Deleted variable: AWS_STACK_NAME');
    } else {
      logWarn('GitHub CLI (gh) is installed but not authenticated. Skipping secrets cleanup.');
    }
  } else {
    logInfo(
      'GitHub CLI (gh) not detected. Please manually remove secrets/variables from repository settings.'
    );
  }

  console.log('\x1b[32mOIDC Teardown Complete!\x1b[0m');
}

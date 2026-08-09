import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCommand, execCommand, getEventProfile } from '../commandUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SETUP_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'setup-kiosk.sh');
const BUILD_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'build-kiosk.sh');
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'docker-compose.yml');
const DEFAULT_DOMAIN = 'wishboard.painless-computing.com';
const VALID_MODES = ['prod', 'dev', 'dual'];

function logStep(msg) {
  console.log(`\x1b[36m==> ${msg}\x1b[0m`);
}
function logInfo(msg) {
  console.log(`    ${msg}`);
}
function logError(msg) {
  console.error(`\x1b[31mERROR: ${msg}\x1b[0m`);
}

function assertMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Mode must be one of: ${VALID_MODES.join(', ')} (got '${mode}').`);
  }
}

/** App image tag to deploy: explicit --app-version, else package.json version, else 'latest'. */
function resolveVersion(appVersion) {
  if (appVersion) return appVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.version || 'latest';
  } catch {
    return 'latest';
  }
}

function assertCommand(name) {
  if (!hasCommand(name)) {
    logError(`Required command '${name}' was not found in PATH. Please install it and retry.`);
    throw new Error(`${name} missing`);
  }
}

function runRemoteKioskSteps(target, remoteTemp, config, dryRun) {
  const { mode, domain, deployRules, appVersion, eventProfile, skipSetup } = config;
  logStep('[2/4] Uploading setup-kiosk.sh, build-kiosk.sh, and docker-compose.yml...');
  for (const src of [SETUP_SCRIPT, BUILD_SCRIPT, COMPOSE_FILE]) {
    const up = execCommand('scp', [src, `${target}:${remoteTemp}/${path.basename(src)}`], {
      dryRun,
    });
    if (up.status !== 0) throw new Error(`Failed to upload ${path.basename(src)} to ${target}.`);
  }

  if (skipSetup) {
    logStep('[3/4] Skipping setup-kiosk.sh (--skip-setup)...');
  } else {
    logStep('[3/4] Running setup-kiosk.sh on the Pi (user, Docker rootless, kiosk, hotspot)...');
    const setupCmd = String.raw`sed -i 's/\r$//' ${remoteTemp}/setup-kiosk.sh && sudo bash ${remoteTemp}/setup-kiosk.sh ${mode} ${domain} ${remoteTemp}`;
    if (execCommand('ssh', [target, setupCmd], { dryRun }).status !== 0) {
      throw new Error('Remote setup-kiosk.sh failed.');
    }
  }

  logStep('[4/4] Running build-kiosk.sh on the Pi (docker compose up + display)...');
  const buildCmd = String.raw`sed -i 's/\r$//' ${remoteTemp}/build-kiosk.sh && sudo bash ${remoteTemp}/build-kiosk.sh ${mode} ${domain} ${deployRules} ${appVersion} ${eventProfile} ${remoteTemp}`;
  if (execCommand('ssh', [target, buildCmd], { dryRun }).status !== 0) {
    throw new Error('Remote build-kiosk.sh failed.');
  }
}

/**
 * Deploys the kiosk stack to a remote Raspberry Pi over SSH. Cross-platform Node
 * port of deploy-kiosk.sh / deploy-kiosk.ps1: uploads the setup/build scripts and
 * docker-compose.yml to a remote temp dir, then runs them with sudo on the Pi.
 */
export function deployKiosk(options) {
  const dryRun = !!options.dryRun;
  const user = options.user || 'pi';
  const host = options.host || 'raspberrypi.local';
  const mode = options.mode || 'dev';
  const domain = options.domain || DEFAULT_DOMAIN;
  const deployRules = options.resetRules ? 'reset' : 'keep';
  const appVersion = resolveVersion(options.appVersion);
  const skipSetup = !!options.skipSetup;
  assertMode(mode);

  const eventProfile = getEventProfile(options);
  const profileDir = path.resolve(PROJECT_ROOT, 'profiles', eventProfile);
  if (!fs.existsSync(profileDir)) {
    throw new Error(`Event profile '${eventProfile}' not found at ${profileDir}`);
  }

  const target = `${user}@${host}`;
  console.log(`\n\x1b[32mWishboard kiosk deployment → ${target}\x1b[0m`);
  logInfo(`Mode: ${mode}   Domain: ${domain}   Version: ${appVersion}   Rules: ${deployRules}`);
  console.log('');

  if (!dryRun) {
    assertCommand('ssh');
    assertCommand('scp');
  }

  // 1. Remote temp dir
  logStep('[1/4] Creating remote temporary directory...');
  let remoteTemp = path.join(os.tmpdir(), 'wishboard-dry-run');
  if (dryRun) {
    logInfo(`[DRY RUN] Would run: ssh ${target} "mktemp -d"`);
  } else {
    const res = execCommand('ssh', [target, 'mktemp -d'], { stdio: 'pipe' });
    remoteTemp = res.stdout.trim();
    if (res.status !== 0 || !remoteTemp) {
      throw new Error(`Failed to create a remote temporary directory on ${target}.`);
    }
    if (!/^\/[\w./-]+$/.test(remoteTemp)) {
      throw new Error(`Invalid remote temporary directory returned: ${remoteTemp}`);
    }
  }

  try {
    runRemoteKioskSteps(
      target,
      remoteTemp,
      { mode, domain, deployRules, appVersion, eventProfile, skipSetup },
      dryRun
    );

    if (dryRun) {
      console.log(
        '\n\x1b[33m[DRY RUN] No changes made. Re-run without --dry-run to deploy.\x1b[0m\n'
      );
    } else {
      console.log('\n\x1b[32mKiosk deployment complete! Container started.\x1b[0m\n');
    }
  } finally {
    // Always clean up the remote temp dir.
    if (!dryRun && remoteTemp && remoteTemp !== '/' && remoteTemp !== '/tmp') {
      logStep('Cleaning up remote temporary directory...');
      execCommand('ssh', [target, 'rm', '-rf', '--', remoteTemp], { stdio: 'pipe' });
    }
  }
}

/**
 * Configures the LOCAL machine as a kiosk by running scripts/setup-kiosk.sh
 * (intended to run on the Raspberry Pi; uses sudo/apt/systemd). The bash script
 * remains the source of truth for Pi system administration.
 */
export function setupKiosk(options) {
  const dryRun = !!options.dryRun;
  const mode = options.mode || 'prod';
  const domain = options.domain || DEFAULT_DOMAIN;
  assertMode(mode);
  if (!dryRun) assertCommand('bash');

  logStep(`Configuring this machine as a Wishboard kiosk (mode: ${mode})...`);
  logInfo('Intended to run on the target Raspberry Pi (uses sudo, apt, systemd).');

  // setup-kiosk.sh moves <dir>/docker-compose.yml into the wishboard home, so
  // stage a COPY in a temp dir — never move the repo's own compose file.
  const stageDir = dryRun
    ? path.join(os.tmpdir(), 'wishboard-kiosk-setup')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-kiosk-'));
  try {
    if (!dryRun && fs.existsSync(COMPOSE_FILE)) {
      fs.copyFileSync(COMPOSE_FILE, path.join(stageDir, 'docker-compose.yml'));
    }
    const res = execCommand('bash', [SETUP_SCRIPT, mode, domain, stageDir], {
      cwd: PROJECT_ROOT,
      dryRun,
    });
    if (res.status !== 0) throw new Error('setup-kiosk.sh failed.');
  } finally {
    if (!dryRun) {
      try {
        fs.rmSync(stageDir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/**
 * Brings up the kiosk container + display locally by running scripts/build-kiosk.sh
 * (intended to run on the Raspberry Pi). The bash script remains the source of truth.
 */
export function runKiosk(options) {
  const dryRun = !!options.dryRun;
  const mode = options.mode || 'dev';
  const domain = options.domain || DEFAULT_DOMAIN;
  const deployRules = options.resetRules ? 'reset' : 'keep';
  const appVersion = resolveVersion(options.appVersion);
  assertMode(mode);
  if (!dryRun) assertCommand('bash');

  logStep(
    `Bringing up the kiosk locally (mode: ${mode}, version: ${appVersion}, rules: ${deployRules})...`
  );
  const res = execCommand('bash', [BUILD_SCRIPT, mode, domain, deployRules, appVersion], {
    cwd: PROJECT_ROOT,
    dryRun,
  });
  if (res.status !== 0) throw new Error('build-kiosk.sh failed.');
}

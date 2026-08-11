import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// npm/npx/sam are .cmd shims on Windows. Since Node's CVE-2024-27980 fix, they
// can't be spawned directly, and `shell: true` with an args array is flagged
// (DEP0190) because arguments are concatenated without escaping. Instead we
// launch them through `cmd.exe /c`, which resolves the .cmd via PATHEXT while
// letting Node apply proper Windows argument escaping.
const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'sam']);

function needsCmdWrapper(command) {
  return process.platform === 'win32' && WINDOWS_CMD_SHIMS.has(command);
}

function spawnCross(command, args, options) {
  if (needsCmdWrapper(command)) {
    // Invoke the interpreter by a fixed absolute path in the (unwriteable)
    // System32 directory rather than a bare "cmd.exe" resolved via PATH, which
    // a writable PATH entry could shadow.
    return spawnSync(String.raw`C:\Windows\System32\cmd.exe`, ['/c', command, ...args], options);
  }
  return spawnSync(command, args, options);
}

/**
 * Checks if a command exists in the system PATH.
 * @param {string} name
 * @returns {boolean}
 */
export function hasCommand(name) {
  try {
    const res = spawnCross(name, ['--version'], { stdio: 'ignore' });
    // When wrapped in cmd.exe, a missing command exits non-zero rather than
    // raising ENOENT, so fall back to checking the exit status in that case.
    if (needsCmdWrapper(name)) {
      return !res.error && res.status === 0;
    }
    return res.error?.code !== 'ENOENT';
  } catch {
    return false;
  }
}

const GITHUB_REMOTE_REGEX = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/;

/**
 * Resolves the GitHub organization (owner) and repository name from git remote.
 * @returns {{ org: string, repo: string } | null}
 */
export function getGitRepoInfo() {
  try {
    const res = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
      const url = res.stdout.trim();
      const match = GITHUB_REMOTE_REGEX.exec(url);
      if (match) {
        return { org: match[1], repo: match[2] };
      }
    }
  } catch {
    // Ignore and fallback
  }

  try {
    const pkgPath = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.repository?.url) {
      const match = GITHUB_REMOTE_REGEX.exec(pkg.repository.url);
      if (match) {
        return { org: match[1], repo: match[2] };
      }
    }
  } catch {
    // Ignore and fallback
  }
  return null;
}

// Flags whose value is a secret and must never be echoed — e.g. in the --dry-run
// preview, which can end up in CI logs. Covers both "--token VALUE" and
// "--token=VALUE" forms. See jssecurity:S8689 and the planned auth-token helper.
const SENSITIVE_FLAG = /^--?(token|secret|password|passphrase|auth-token)$/i;
const SENSITIVE_FLAG_INLINE = /^(--?(?:token|secret|password|passphrase|auth-token))=/i;

/**
 * Returns a copy of `args` with the value of any sensitive flag masked, so a
 * dry-run echo never leaks a token/secret into the terminal or CI logs.
 * @param {string[]} args
 * @returns {string[]}
 */
export function redactArgs(args) {
  const redacted = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const inline = SENSITIVE_FLAG_INLINE.exec(arg);
    if (inline) {
      redacted.push(`${inline[1]}=***`);
      continue;
    }
    redacted.push(arg);
    // "--token VALUE": mask the following value unless it's another flag.
    if (SENSITIVE_FLAG.test(arg) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      redacted.push('***');
      i += 1;
    }
  }
  return redacted;
}

/**
 * Helper to run a system command cross-platform.
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function execCommand(command, args, options = {}) {
  const { stdio = 'inherit', dryRun = false } = options;
  if (dryRun) {
    const argsString = redactArgs(args)
      .map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
      .join(' ');
    console.log(`[DRY RUN] Would execute: ${command} ${argsString}`);
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnCross(command, args, { stdio, encoding: 'utf8', ...options });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`Command not found in PATH: ${command}`);
    }
    throw result.error;
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Sets environment variables for AWS SDK operations based on CLI options.
 * @param {object} [options={}]
 */
export function setupAwsEnv(options = {}) {
  if (options.profile) {
    process.env.AWS_PROFILE = options.profile;
  }
  if (options.region) {
    process.env.AWS_REGION = options.region;
    process.env.AWS_DEFAULT_REGION = options.region;
  }
}
import { DEFAULT_EVENT_PROFILE } from '../server/configManager.js';

export { DEFAULT_EVENT_PROFILE };

/**
 * Resolves the active event profile name from CLI options, process.env, or default fallback.
 * @param {object} [options={}]
 * @returns {string}
 */
export function getEventProfile(options = {}) {
  return options.eventProfile || process.env.EVENT_PROFILE || DEFAULT_EVENT_PROFILE;
}

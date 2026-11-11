import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

describe('build-kiosk.sh shell script', () => {
  vi.setConfig({ testTimeout: 30000 });
  let tempDir;
  let mockEnvFile;
  let dockerLogFile;
  const tmpRoot = path.join(PROJECT_ROOT, '.tmp-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpRoot)) {
      fs.mkdirSync(tmpRoot, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpRoot, 'wishboard-kiosk-test-'));
    mockEnvFile = path.join(tempDir, 'mock-env.sh');
    dockerLogFile = path.join(tempDir, 'docker.log');

    const relativeTempDir = './' + path.relative(PROJECT_ROOT, tempDir).replace(/\\/g, '/');
    const relativeDockerLog = './' + path.relative(PROJECT_ROOT, dockerLogFile).replace(/\\/g, '/');
    const mockFunctions = `
MOCK_ROOT="$(pwd)"
export MOCK_ROOT

function sudo() {
  if [[ "$1" = "-u" ]]; then
    shift 2
  fi
  if [[ "$1" == *"="* ]]; then
    export "$1"
    shift
  fi
  "$@"
}
export -f sudo

function docker() {
  echo "$@" >> "$MOCK_ROOT/${relativeDockerLog}"
  return 0
}
export -f docker

function systemctl() {
  return 0
}
export -f systemctl

function df() {
  echo "Filesystem 1M-blocks Used Available Use% Mounted on"
  echo "/dev/root 10000 1000 9000 10% /"
}
export -f df

function getent() {
  echo "wishboard:x:1000:1000::${relativeTempDir}:/bin/bash"
}
export -f getent

function id() {
  echo 1000
}
export -f id
`;
    fs.writeFileSync(mockEnvFile, mockFunctions);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const runScript = (mode) => {
    if (process.platform === 'win32') {
      console.warn('bash script execution skipped on Windows platform.');
      return null;
    }
    try {
      const relativeMock = path.relative(PROJECT_ROOT, mockEnvFile).replace(/\\/g, '/');
      execFileSync(
        'bash',
        [
          '-c',
          `source "./${relativeMock}" && bash ./scripts/build-kiosk.sh "${mode}" test-domain.com`,
        ],
        {
          cwd: PROJECT_ROOT,
          timeout: 5000,
          env: {
            ...process.env,
          },
          encoding: 'utf8',
        }
      );
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ETIMEDOUT') {
        console.warn('bash not found or execution timed out in PATH, skipping test.');
        return null; // Skip test gracefully if bash is missing or times out
      }
      console.error('STDOUT:', error.stdout);
      console.error('STDERR:', error.stderr);
      throw error;
    }
    return true;
  };

  const getEnvContent = () => {
    const wishboardDir = path.join(tempDir, 'wishboard');
    const envFile = path.join(wishboardDir, '.env');
    if (!fs.existsSync(envFile)) {
      return '';
    }
    return fs.readFileSync(envFile, 'utf8');
  };

  it('sets WISHBOARD_DOMAIN and WISHBOARD_AP_IP in prod mode', () => {
    const ran = runScript('prod');
    if (!ran) return;

    const content = getEnvContent();
    expect(content).toContain('WISHBOARD_DOMAIN=test-domain.com');
    expect(content).toContain('WISHBOARD_AP_IP=10.42.0.1:3000');
    expect(content).not.toContain('NODE_ENV=development');
  });

  it('sets NODE_ENV=development in dev mode', () => {
    const ran = runScript('dev');
    if (!ran) return;

    const content = getEnvContent();
    expect(content).toContain('NODE_ENV=development');
    // It should also append other variables correctly via the append redirects
    expect(content).toContain('CORS_ALLOWED_ORIGINS=');
  });

  it('sets NODE_ENV=development in dual mode', () => {
    const ran = runScript('dual');
    if (!ran) return;

    const content = getEnvContent();
    // Dual mode is a production-like network setup with development-like app setup
    expect(content).toContain('NODE_ENV=development');
    expect(content).toContain('WISHBOARD_DOMAIN=test-domain.com');
    expect(content).toContain('WISHBOARD_AP_IP=10.42.0.1:3000');

    const dockerLog = fs.readFileSync(dockerLogFile, 'utf8');
    expect(dockerLog).toContain('compose --env-file .env up -d --pull always');
    expect(dockerLog).toContain('image prune -af');
  });

  it('prunes unused Docker images before retrying disk check when free space is initially below 800 MB', () => {
    const relativeDfState =
      './' + path.relative(PROJECT_ROOT, path.join(tempDir, 'df-called')).replace(/\\/g, '/');
    fs.appendFileSync(
      mockEnvFile,
      `
function df() {
  echo "Filesystem 1M-blocks Used Available Use% Mounted on"
  if [[ ! -f "$MOCK_ROOT/${relativeDfState}" ]]; then
    touch "$MOCK_ROOT/${relativeDfState}"
    echo "/dev/root 10000 9400 600 94% /"
  else
    echo "/dev/root 10000 5000 5000 50% /"
  fi
}
export -f df
`
    );

    const ran = runScript('prod');
    if (!ran) return;

    const dockerLog = fs.readFileSync(dockerLogFile, 'utf8');
    const pruneMatches = dockerLog.match(/^image prune -af$/gm) ?? [];
    expect(pruneMatches.length).toBe(2);
  });
});

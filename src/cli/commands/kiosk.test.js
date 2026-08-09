import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deployKiosk, setupKiosk, runKiosk } from './kiosk.js';
import * as commandUtils from '../commandUtils.js';
import fs from 'node:fs';

vi.mock('../commandUtils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hasCommand: vi.fn(() => true),
    execCommand: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  };
});

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => '{"version":"9.9.9"}'),
    existsSync: vi.fn(() => true),
    mkdtempSync: vi.fn(() => '/tmp/wishboard-kiosk-abc'),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

// mktemp -d returns a remote dir; everything else succeeds.
function defaultExec(cmd, args = []) {
  if (cmd === 'ssh' && args.some((a) => String(a).includes('mktemp'))) {
    return { status: 0, stdout: '/tmp/remote-xyz\n', stderr: '' };
  }
  return { status: 0, stdout: '', stderr: '' };
}

const sshCmds = () =>
  vi
    .mocked(commandUtils.execCommand)
    .mock.calls.filter((c) => c[0] === 'ssh')
    .map((c) => c[1][1]);

describe('kiosk commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
    vi.mocked(commandUtils.execCommand).mockImplementation(defaultExec);
    vi.mocked(fs.readFileSync).mockReturnValue('{"version":"9.9.9"}');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/wishboard-kiosk-abc');
  });

  describe('deployKiosk', () => {
    it('rejects an invalid mode', () => {
      expect(() => deployKiosk({ mode: 'staging' })).toThrow(/Mode must be one of/);
    });

    it('orchestrates mktemp -> scp x3 -> setup -> build -> cleanup over SSH', () => {
      deployKiosk({
        user: 'pi',
        host: 'pi.local',
        mode: 'prod',
        domain: 'ex.com',
        appVersion: '2.0.0',
        resetRules: true,
      });
      const calls = vi.mocked(commandUtils.execCommand).mock.calls;

      expect(
        calls.some((c) => c[0] === 'ssh' && c[1][0] === 'pi@pi.local' && c[1][1] === 'mktemp -d')
      ).toBe(true);

      const scpDests = calls.filter((c) => c[0] === 'scp').map((c) => c[1][1]);
      expect(scpDests.some((d) => d.includes('setup-kiosk.sh'))).toBe(true);
      expect(scpDests.some((d) => d.includes('build-kiosk.sh'))).toBe(true);
      expect(scpDests.some((d) => d.includes('docker-compose.yml'))).toBe(true);

      expect(sshCmds().some((s) => s.includes('setup-kiosk.sh prod ex.com'))).toBe(true);
      expect(sshCmds().some((s) => s.includes('build-kiosk.sh prod ex.com reset 2.0.0'))).toBe(
        true
      );
      const rmCalls = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.filter((c) => c[0] === 'ssh' && c[1][1] === 'rm');
      expect(rmCalls.length).toBeGreaterThan(0);
      expect(rmCalls[0][1]).toEqual(['pi@pi.local', 'rm', '-rf', '--', '/tmp/remote-xyz']);
    });

    it('defaults rules to keep and version to the package.json version', () => {
      deployKiosk({ host: 'pi.local', mode: 'dev' });
      expect(
        sshCmds().some((s) => s.includes('build-kiosk.sh dev') && s.includes('keep 9.9.9'))
      ).toBe(true);
    });

    it('skips setup-kiosk.sh when skipSetup is true', () => {
      deployKiosk({ host: 'pi.local', mode: 'dev', skipSetup: true });
      expect(sshCmds().some((s) => s.includes('setup-kiosk.sh'))).toBe(false);
      expect(sshCmds().some((s) => s.includes('build-kiosk.sh'))).toBe(true);
    });

    it('throws if ssh is missing', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd !== 'ssh');
      expect(() => deployKiosk({ host: 'pi.local' })).toThrow('ssh missing');
    });

    it('throws if the remote temp dir cannot be created', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'ssh' && args.some((a) => String(a).includes('mktemp'))) {
          return { status: 1, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      expect(() => deployKiosk({ host: 'pi.local' })).toThrow(/remote temporary directory/);
    });

    it('honours --dry-run and does not require ssh/scp to be installed', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(false); // would throw if assertCommand ran
      deployKiosk({ host: 'pi.local', dryRun: true });
      const calls = vi.mocked(commandUtils.execCommand).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => c[2]?.dryRun === true)).toBe(true);
    });

    it('does not claim the container started when doing a dry run', () => {
      deployKiosk({ host: 'pi.local', dryRun: true });
      const logged = vi
        .mocked(console.log)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
      expect(logged).not.toContain('Container started');
      expect(logged).toContain('[DRY RUN] No changes made');
    });
  });

  describe('setupKiosk', () => {
    it('runs setup-kiosk.sh with mode/domain and a staged compose copy', () => {
      setupKiosk({ mode: 'prod', domain: 'ex.com' });
      const call = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'bash' && String(c[1][0]).includes('setup-kiosk.sh'));
      expect(call).toBeDefined();
      expect(call[1].slice(1, 3)).toEqual(['prod', 'ex.com']);
      // A copy of docker-compose.yml is staged so the repo's own file is never moved.
      expect(fs.copyFileSync).toHaveBeenCalled();
    });

    it('rejects an invalid mode', () => {
      expect(() => setupKiosk({ mode: 'nope' })).toThrow(/Mode must be one of/);
    });

    it('is side-effect-free in dry-run (no staged copy, no temp dir created/removed)', () => {
      setupKiosk({ mode: 'dual', dryRun: true });
      const call = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'bash' && String(c[1][0]).includes('setup-kiosk.sh'));
      expect(call).toBeDefined();
      expect(call[1][1]).toBe('dual');
      expect(call[2]?.dryRun).toBe(true);
      // Dry-run must not touch the filesystem: no mkdtemp, no staged copy, no cleanup.
      expect(fs.mkdtempSync).not.toHaveBeenCalled();
      expect(fs.copyFileSync).not.toHaveBeenCalled();
      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });

  describe('runKiosk', () => {
    it('runs build-kiosk.sh with mode/domain/rules/version', () => {
      runKiosk({ mode: 'prod', domain: 'ex.com', resetRules: true, appVersion: '3.1.4' });
      const call = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'bash' && String(c[1][0]).includes('build-kiosk.sh'));
      expect(call).toBeDefined();
      expect(call[1].slice(1)).toEqual(['prod', 'ex.com', 'reset', '3.1.4']);
    });
  });
});

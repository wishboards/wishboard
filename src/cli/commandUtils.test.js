import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hasCommand, getGitRepoInfo, execCommand, redactArgs } from './commandUtils.js';

vi.mock('node:child_process', () => {
  const m = {
    spawnSync: vi.fn(),
  };
  return {
    ...m,
    default: m,
  };
});

// getGitRepoInfo falls back to reading package.json when `git remote` fails, so
// the fallback has to be mocked too or the result depends on where the module is
// executed from. Under Stryker the module runs from a sandbox whose package.json
// does resolve a repository.url, which made the "returns null" case pass locally
// and in CI but fail Stryker's initial dry run.
vi.mock('node:fs', () => {
  const m = {
    readFileSync: vi.fn(),
  };
  return {
    ...m,
    default: m,
  };
});

describe('commandUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasCommand', () => {
    it('returns true if the command exists (no ENOENT error)', () => {
      vi.mocked(spawnSync).mockReturnValue({ error: undefined });
      expect(hasCommand('some-cmd')).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith('some-cmd', ['--version'], { stdio: 'ignore' });
    });

    it('returns false if the command does not exist (ENOENT error)', () => {
      vi.mocked(spawnSync).mockReturnValue({ error: { code: 'ENOENT' } });
      expect(hasCommand('missing-cmd')).toBe(false);
    });

    it('returns false if spawnSync throws an error', () => {
      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('Spawn failed');
      });
      expect(hasCommand('err-cmd')).toBe(false);
    });
  });

  describe('getGitRepoInfo', () => {
    it('parses ssh/git remote URL correctly', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'git@github.com:someorg/somerepo.git\n',
        stderr: '',
      });

      const info = getGitRepoInfo();
      expect(info).toEqual({ org: 'someorg', repo: 'somerepo' });
      expect(spawnSync).toHaveBeenCalledWith('git', ['remote', 'get-url', 'origin'], {
        encoding: 'utf8',
      });
    });

    it('parses https remote URL correctly', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'https://github.com/anotherorg/anotherrepo.git\n',
        stderr: '',
      });

      const info = getGitRepoInfo();
      expect(info).toEqual({ org: 'anotherorg', repo: 'anotherrepo' });
    });

    it('falls back to the package.json repository url when git remote fails', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error',
      });
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ repository: { url: 'git+https://github.com/pkgorg/pkgrepo.git' } })
      );

      expect(getGitRepoInfo()).toEqual({ org: 'pkgorg', repo: 'pkgrepo' });
    });

    it('returns null if the command fails and package.json is unreadable', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error',
      });
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(getGitRepoInfo()).toBeNull();
    });

    it('returns null if the command fails and package.json has no repository', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error',
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'wishboard' }));

      expect(getGitRepoInfo()).toBeNull();
    });
  });

  describe('execCommand', () => {
    it('executes command and returns output', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'output\n',
        stderr: '',
      });

      const res = execCommand('my-command', ['arg1', 'arg2']);
      expect(res).toEqual({ status: 0, stdout: 'output\n', stderr: '' });
      expect(spawnSync).toHaveBeenCalledWith('my-command', ['arg1', 'arg2'], {
        stdio: 'inherit',
        encoding: 'utf8',
      });
    });

    it('logs command but does not execute it in dryRun mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = execCommand('my-command', ['arg1', 'arg 2'], { dryRun: true });

      expect(res).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(spawnSync).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[DRY RUN] Would execute: my-command arg1 "arg 2"');

      consoleSpy.mockRestore();
    });

    it('redacts secret flag values in the dryRun echo (never logs a token)', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      execCommand('wishboard', ['auth', 'token', '--token', 'super-secret-value'], {
        dryRun: true,
      });

      const logged = consoleSpy.mock.calls[0][0];
      expect(logged).toContain('--token ***');
      expect(logged).not.toContain('super-secret-value');

      consoleSpy.mockRestore();
    });

    it('throws error when command is missing', () => {
      vi.mocked(spawnSync).mockReturnValue({
        error: { code: 'ENOENT' },
      });

      expect(() => execCommand('missing-cmd', [])).toThrow(
        'Command not found in PATH: missing-cmd'
      );
    });

    it('throws other errors encountered during spawn', () => {
      const customError = new Error('Permission denied');
      vi.mocked(spawnSync).mockReturnValue({
        error: customError,
      });

      expect(() => execCommand('err-cmd', [])).toThrow(customError);
    });
  });

  describe('redactArgs', () => {
    it('masks the value after a sensitive flag (space form)', () => {
      expect(redactArgs(['--token', 'abc123', '--region', 'us-east-1'])).toEqual([
        '--token',
        '***',
        '--region',
        'us-east-1',
      ]);
    });

    it('masks the inline value of a sensitive flag (=value form)', () => {
      expect(redactArgs(['--secret=hunter2', 'deploy'])).toEqual(['--secret=***', 'deploy']);
    });

    it('covers all sensitive flag names case-insensitively', () => {
      expect(redactArgs(['--Password', 'p', '--passphrase', 'q', '--auth-token', 'r'])).toEqual([
        '--Password',
        '***',
        '--passphrase',
        '***',
        '--auth-token',
        '***',
      ]);
    });

    it('leaves non-sensitive args untouched', () => {
      expect(redactArgs(['deploy', '--mode', 'prod'])).toEqual(['deploy', '--mode', 'prod']);
    });

    it('does not consume a following flag as a secret value, and tolerates a trailing flag', () => {
      expect(redactArgs(['--token', '--verbose'])).toEqual(['--token', '--verbose']);
      expect(redactArgs(['--token'])).toEqual(['--token']);
    });
  });
});

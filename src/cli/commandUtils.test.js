import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  hasCommand,
  getGitRepoInfo,
  execCommand,
  redactArgs,
  setupAwsEnv,
  getEventProfile,
} from './commandUtils.js';

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
      expect(
        redactArgs([
          '--Password',
          'p',
          '--passphrase',
          'q',
          '--auth-token',
          'r',
          '--sonar-token',
          'st',
          '--stryker-key',
          'sk',
          '--gitleaks-license',
          'gl',
          '--database-auth-token',
          'db',
        ])
      ).toEqual([
        '--Password',
        '***',
        '--passphrase',
        '***',
        '--auth-token',
        '***',
        '--sonar-token',
        '***',
        '--stryker-key',
        '***',
        '--gitleaks-license',
        '***',
        '--database-auth-token',
        '***',
      ]);
    });

    it('leaves non-sensitive args untouched', () => {
      expect(redactArgs(['deploy', '--mode', 'prod'])).toEqual(['deploy', '--mode', 'prod']);
    });

    it('does not consume a following flag as a secret value, and tolerates a trailing flag', () => {
      expect(redactArgs(['--token', '--verbose'])).toEqual(['--token', '--verbose']);
      expect(redactArgs(['--token'])).toEqual(['--token']);
      expect(redactArgs(['--token', '-x'])).toEqual(['--token', '-x']);
    });

    it('masks single-dash sensitive flags too', () => {
      expect(redactArgs(['-token', 'abc'])).toEqual(['-token', '***']);
      expect(redactArgs(['-secret=abc'])).toEqual(['-secret=***']);
    });

    it('does not mask flags that merely start with a sensitive name', () => {
      expect(redactArgs(['--tokenize', 'abc'])).toEqual(['--tokenize', 'abc']);
      expect(redactArgs(['--tokens', 'abc'])).toEqual(['--tokens', 'abc']);
      expect(redactArgs(['--tokenize=abc'])).toEqual(['--tokenize=abc']);
    });

    it('does not mask a sensitive name that is not at the start of the arg', () => {
      expect(redactArgs(['x--token=abc'])).toEqual(['x--token=abc']);
      expect(redactArgs(['prefix--token', 'abc'])).toEqual(['prefix--token', 'abc']);
    });

    it('preserves the exact flag spelling and case in the inline mask', () => {
      expect(redactArgs(['--Sonar-Token=abc'])).toEqual(['--Sonar-Token=***']);
      expect(redactArgs(['--DATABASE-AUTH-TOKEN=abc'])).toEqual(['--DATABASE-AUTH-TOKEN=***']);
    });
  });

  describe('execCommand result defaults', () => {
    it('defaults missing status/stdout/stderr to 0 and empty strings', () => {
      vi.mocked(spawnSync).mockReturnValue({});
      expect(execCommand('cmd', [])).toEqual({ status: 0, stdout: '', stderr: '' });
      vi.mocked(spawnSync).mockReturnValue({ status: null, stdout: null, stderr: null });
      expect(execCommand('cmd', [])).toEqual({ status: 0, stdout: '', stderr: '' });
    });

    it('passes through a non-zero status and both streams verbatim', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 3, stdout: 'out', stderr: 'err' });
      expect(execCommand('cmd', [])).toEqual({ status: 3, stdout: 'out', stderr: 'err' });
    });

    it('dryRun redacts before quoting and leaves plain args unquoted', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      execCommand('cmd', ['--token', 'a b', 'plain'], { dryRun: true });
      expect(consoleSpy).toHaveBeenCalledWith('[DRY RUN] Would execute: cmd --token *** plain');
      consoleSpy.mockRestore();
    });
  });

  describe('getGitRepoInfo fallthrough and parsing boundaries', () => {
    const pkgFallback = (url) => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ repository: { url } }));
    };

    it('ignores a git remote URL when git exits non-zero, even if stdout looks valid', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: 'git@github.com:gitorg/gitrepo.git\n',
        stderr: 'error',
      });
      pkgFallback('https://github.com/pkgorg/pkgrepo.git');
      expect(getGitRepoInfo()).toEqual({ org: 'pkgorg', repo: 'pkgrepo' });
    });

    it('falls back when git succeeds with empty stdout', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      pkgFallback('https://github.com/pkgorg/pkgrepo.git');
      expect(getGitRepoInfo()).toEqual({ org: 'pkgorg', repo: 'pkgrepo' });
    });

    it('falls back when the git remote is not a GitHub URL', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'git@gitlab.com:someorg/somerepo.git\n',
        stderr: '',
      });
      pkgFallback('https://github.com/pkgorg/pkgrepo.git');
      expect(getGitRepoInfo()).toEqual({ org: 'pkgorg', repo: 'pkgrepo' });
    });

    it('parses single-character org and repo, with and without .git', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'git@github.com:a/b\n',
        stderr: '',
      });
      expect(getGitRepoInfo()).toEqual({ org: 'a', repo: 'b' });
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'https://github.com:a/b.git\n',
        stderr: '',
      });
      expect(getGitRepoInfo()).toEqual({ org: 'a', repo: 'b' });
    });

    it('truncates the repo name at the first dot', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: 'https://github.com/org/re.po\n',
        stderr: '',
      });
      expect(getGitRepoInfo()).toEqual({ org: 'org', repo: 're' });
    });

    it('returns null for package.json shapes without a usable repository URL', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'error' });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ repository: {} }));
      expect(getGitRepoInfo()).toBeNull();
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ repository: { url: 'https://gitlab.com/org/repo.git' } })
      );
      expect(getGitRepoInfo()).toBeNull();
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ repository: 'git@github.com:org/repo.git' })
      );
      expect(getGitRepoInfo()).toBeNull();
      vi.mocked(readFileSync).mockReturnValue('{not json');
      expect(getGitRepoInfo()).toBeNull();
    });
  });

  describe('windows cmd shim wrapping', () => {
    const originalPlatform = process.platform;
    const setPlatform = (value) => Object.defineProperty(process, 'platform', { value });

    afterEach(() => {
      setPlatform(originalPlatform);
    });

    it('wraps npm, npx and sam through the System32 cmd.exe on win32 only', () => {
      setPlatform('win32');
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      for (const shim of ['npm', 'npx', 'sam']) {
        execCommand(shim, ['--version']);
        expect(spawnSync).toHaveBeenCalledWith(
          String.raw`C:\Windows\System32\cmd.exe`,
          ['/c', shim, '--version'],
          { stdio: 'inherit', encoding: 'utf8' }
        );
      }
      execCommand('git', ['status']);
      expect(spawnSync).toHaveBeenCalledWith('git', ['status'], {
        stdio: 'inherit',
        encoding: 'utf8',
      });
    });

    it('does not wrap anything on non-windows platforms', () => {
      setPlatform('linux');
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      execCommand('npm', ['install']);
      expect(spawnSync).toHaveBeenCalledWith('npm', ['install'], {
        stdio: 'inherit',
        encoding: 'utf8',
      });
    });

    it('hasCommand on win32 trusts the exit status for wrapped commands', () => {
      setPlatform('win32');
      vi.mocked(spawnSync).mockReturnValue({ error: undefined, status: 0 });
      expect(hasCommand('npm')).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith(
        String.raw`C:\Windows\System32\cmd.exe`,
        ['/c', 'npm', '--version'],
        { stdio: 'ignore' }
      );
      vi.mocked(spawnSync).mockReturnValue({ error: undefined, status: 1 });
      expect(hasCommand('npm')).toBe(false);
      vi.mocked(spawnSync).mockReturnValue({ error: new Error('boom'), status: 0 });
      expect(hasCommand('npm')).toBe(false);
    });

    it('hasCommand on win32 uses the ENOENT rule for unwrapped commands', () => {
      setPlatform('win32');
      vi.mocked(spawnSync).mockReturnValue({ error: undefined, status: 1 });
      expect(hasCommand('git')).toBe(true);
      vi.mocked(spawnSync).mockReturnValue({ error: { code: 'ENOENT' }, status: 1 });
      expect(hasCommand('git')).toBe(false);
    });

    it('hasCommand treats a non-ENOENT error as present on posix', () => {
      setPlatform('linux');
      vi.mocked(spawnSync).mockReturnValue({ error: { code: 'EACCES' } });
      expect(hasCommand('some-cmd')).toBe(true);
    });
  });

  describe('setupAwsEnv', () => {
    const keys = ['AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION'];
    let saved;
    beforeEach(() => {
      saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      for (const k of keys) delete process.env[k];
    });
    afterEach(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('sets only AWS_PROFILE when only a profile is given', () => {
      setupAwsEnv({ profile: 'my-profile' });
      expect(process.env.AWS_PROFILE).toBe('my-profile');
      expect(process.env.AWS_REGION).toBeUndefined();
      expect(process.env.AWS_DEFAULT_REGION).toBeUndefined();
    });

    it('sets both region variables when only a region is given', () => {
      setupAwsEnv({ region: 'eu-west-1' });
      expect(process.env.AWS_REGION).toBe('eu-west-1');
      expect(process.env.AWS_DEFAULT_REGION).toBe('eu-west-1');
      expect(process.env.AWS_PROFILE).toBeUndefined();
    });

    it('sets everything when both are given, and nothing for empty options', () => {
      setupAwsEnv({ profile: 'p', region: 'us-east-1' });
      expect(process.env.AWS_PROFILE).toBe('p');
      expect(process.env.AWS_REGION).toBe('us-east-1');
      expect(process.env.AWS_DEFAULT_REGION).toBe('us-east-1');
      for (const k of keys) delete process.env[k];
      setupAwsEnv();
      setupAwsEnv({});
      for (const k of keys) expect(process.env[k]).toBeUndefined();
    });
  });

  describe('getEventProfile', () => {
    let savedEnv;
    beforeEach(() => {
      savedEnv = process.env.EVENT_PROFILE;
      delete process.env.EVENT_PROFILE;
    });
    afterEach(() => {
      if (savedEnv === undefined) delete process.env.EVENT_PROFILE;
      else process.env.EVENT_PROFILE = savedEnv;
    });

    it('falls back to the default profile', () => {
      expect(getEventProfile()).toBe('lifestyle');
      expect(getEventProfile({})).toBe('lifestyle');
    });

    it('uses EVENT_PROFILE over the default, and the option over the env', () => {
      process.env.EVENT_PROFILE = 'env-profile';
      expect(getEventProfile()).toBe('env-profile');
      expect(getEventProfile({ eventProfile: 'opt-profile' })).toBe('opt-profile');
    });

    it('treats an empty-string option as unset', () => {
      process.env.EVENT_PROFILE = 'env-profile';
      expect(getEventProfile({ eventProfile: '' })).toBe('env-profile');
    });
  });
});

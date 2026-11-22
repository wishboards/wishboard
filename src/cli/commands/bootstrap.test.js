import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoInfo, provisionTursoDatabase, runBootstrap } from './bootstrap.js';
import * as commandUtils from '../commandUtils.js';

describe('bootstrap command', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveRepoInfo', () => {
    it('returns provided org, repo, and region', () => {
      const res = resolveRepoInfo({ org: 'custom-org', repo: 'custom-repo', region: 'eu-west-1' });
      expect(res).toEqual({ org: 'custom-org', repo: 'custom-repo', region: 'eu-west-1' });
    });

    it('defaults region to us-east-1 when unspecified', () => {
      const res = resolveRepoInfo({ org: 'custom-org', repo: 'custom-repo' });
      expect(res).toEqual({ org: 'custom-org', repo: 'custom-repo', region: 'us-east-1' });
    });

    it('detects org and repo from getGitRepoInfo when omitted', () => {
      const getGitRepoInfoSpy = vi.spyOn(commandUtils, 'getGitRepoInfo').mockReturnValue({
        org: 'auto-org',
        repo: 'auto-repo',
      });
      const res = resolveRepoInfo();
      expect(res).toEqual({ org: 'auto-org', repo: 'auto-repo', region: 'us-east-1' });
      getGitRepoInfoSpy.mockRestore();
    });

    it('throws when org/repo are missing and cannot be detected', () => {
      const getGitRepoInfoSpy = vi.spyOn(commandUtils, 'getGitRepoInfo').mockReturnValue(null);
      expect(() => resolveRepoInfo()).toThrow(
        /Could not detect GitHub repository from Git remote or package\.json/
      );
      getGitRepoInfoSpy.mockRestore();
    });
  });

  describe('provisionTursoDatabase', () => {
    it('returns provided databaseUrl and databaseAuthToken without invoking turso CLI', () => {
      const exec = vi.fn();
      const has = vi.fn().mockReturnValue(true);

      const res = provisionTursoDatabase(
        'mydb',
        { databaseUrl: 'libsql://custom.turso.io', databaseAuthToken: 'token123' },
        { execCommand: exec, hasCommand: has }
      );

      expect(res).toEqual({
        url: 'libsql://custom.turso.io',
        token: 'token123',
        provisioned: false,
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('uses DATABASE_URL and DATABASE_AUTH_TOKEN from environment if set', () => {
      process.env.DATABASE_URL = 'libsql://env.turso.io';
      process.env.DATABASE_AUTH_TOKEN = 'env-token';
      const exec = vi.fn();

      const res = provisionTursoDatabase('mydb', {}, { execCommand: exec });
      expect(res).toEqual({
        url: 'libsql://env.turso.io',
        token: 'env-token',
        provisioned: false,
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('returns dry run mock url and token when dryRun is true and turso CLI exists', () => {
      const exec = vi.fn();
      const has = vi.fn().mockReturnValue(true);

      const res = provisionTursoDatabase(
        'mydb',
        { dryRun: true },
        { execCommand: exec, hasCommand: has }
      );

      expect(res).toEqual({
        url: 'libsql://dry-run-db.turso.io',
        token: 'dry-run-turso-token',
        provisioned: true,
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('resolves existing Turso database url and generates a new token', () => {
      const exec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'db' && args[1] === 'show') {
          return { status: 0, stdout: 'libsql://existing.turso.io\n', stderr: '' };
        }
        if (args[0] === 'db' && args[1] === 'tokens' && args[2] === 'create') {
          return { status: 0, stdout: 'gen-token-456\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      const has = vi.fn().mockReturnValue(true);

      const res = provisionTursoDatabase('existing-db', {}, { execCommand: exec, hasCommand: has });

      expect(res).toEqual({
        url: 'libsql://existing.turso.io',
        token: 'gen-token-456',
        provisioned: true,
      });
      expect(exec).toHaveBeenCalledWith('turso', ['db', 'show', 'existing-db', '--url'], {
        stdio: 'pipe',
      });
      expect(exec).toHaveBeenCalledWith('turso', ['db', 'tokens', 'create', 'existing-db'], {
        stdio: 'pipe',
      });
    });

    it('creates new Turso database if db show fails initially', () => {
      let shownOnce = false;
      const exec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'db' && args[1] === 'show') {
          if (!shownOnce) {
            shownOnce = true;
            return { status: 1, stdout: '', stderr: 'db not found' };
          }
          return { status: 0, stdout: 'libsql://newly-created.turso.io\n', stderr: '' };
        }
        if (args[0] === 'db' && args[1] === 'create') {
          return { status: 0, stdout: 'Created mydb', stderr: '' };
        }
        if (args[0] === 'db' && args[1] === 'tokens' && args[2] === 'create') {
          return { status: 0, stdout: 'new-token-789\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      const has = vi.fn().mockReturnValue(true);

      const res = provisionTursoDatabase('mydb', {}, { execCommand: exec, hasCommand: has });

      expect(res).toEqual({
        url: 'libsql://newly-created.turso.io',
        token: 'new-token-789',
        provisioned: true,
      });
      expect(exec).toHaveBeenCalledWith('turso', ['db', 'create', 'mydb'], { stdio: 'pipe' });
    });

    it('throws error if turso db create fails', () => {
      const exec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'db' && args[1] === 'show') {
          return { status: 1, stdout: '', stderr: 'db not found' };
        }
        if (args[0] === 'db' && args[1] === 'create') {
          return { status: 1, stdout: '', stderr: 'Quota exceeded' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      const has = vi.fn().mockReturnValue(true);

      expect(() =>
        provisionTursoDatabase('mydb', {}, { execCommand: exec, hasCommand: has })
      ).toThrow(/Failed to create Turso database 'mydb': Quota exceeded/);
    });

    it('throws error if turso db tokens create fails', () => {
      const exec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'db' && args[1] === 'show') {
          return { status: 0, stdout: 'libsql://mydb.turso.io', stderr: '' };
        }
        if (args[0] === 'db' && args[1] === 'tokens' && args[2] === 'create') {
          return { status: 1, stdout: '', stderr: 'Token limit reached' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      const has = vi.fn().mockReturnValue(true);

      expect(() =>
        provisionTursoDatabase('mydb', {}, { execCommand: exec, hasCommand: has })
      ).toThrow(/Failed to generate Turso token for 'mydb': Token limit reached/);
    });

    it('returns empty url and token if turso CLI is not available and no creds provided', () => {
      const exec = vi.fn();
      const has = vi.fn().mockReturnValue(false);

      const res = provisionTursoDatabase('mydb', {}, { execCommand: exec, hasCommand: has });
      expect(res).toEqual({
        url: '',
        token: '',
        provisioned: false,
      });
    });
  });

  describe('runBootstrap', () => {
    it('executes full bootstrap flow with all phases', async () => {
      const setupOidcMock = vi.fn().mockResolvedValue();
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);
      const checkGitHubAuthMock = vi.fn().mockReturnValue(true);
      const hasCommandMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          region: 'us-west-2',
          sonarToken: 'sonar-123',
          strykerKey: 'stryker-456',
          gitleaksLicense: 'gitleaks-789',
          databaseUrl: 'libsql://test.turso.io',
          databaseAuthToken: 'db-token-abc',
          eventProfile: 'lifestyle',
        },
        {
          setupOidc: setupOidcMock,
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          checkGitHubAuth: checkGitHubAuthMock,
          hasCommand: hasCommandMock,
        }
      );

      // Verify secrets
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'secret',
        'SONAR_TOKEN',
        'sonar-123',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'secret',
        'STRYKER_DASHBOARD_API_KEY',
        'stryker-456',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'secret',
        'GITLEAKS_LICENSE',
        'gitleaks-789',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'secret',
        'GITLEAKS_LICENSE',
        'gitleaks-789',
        false,
        'dependabot'
      );

      // Verify OIDC
      expect(setupOidcMock).toHaveBeenCalledWith({
        org: 'test-org',
        repo: 'test-repo',
        region: 'us-west-2',
        dryRun: false,
      });

      // Verify SSM and DB variables
      expect(setSsmTokenMock).toHaveBeenCalledWith(
        '/test-repo/lifestyle/database-auth-token',
        'db-token-abc',
        { region: 'us-west-2', dryRun: false },
        expect.any(Function),
        expect.any(Function)
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_DATABASE_URL',
        'libsql://test.turso.io',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_DATABASE_AUTH_TOKEN_SSM',
        '/test-repo/lifestyle/database-auth-token',
        false
      );
      expect(setGitHubRepoValueMock).not.toHaveBeenCalledWith(
        'variable',
        'DATABASE_URL',
        expect.anything(),
        expect.anything()
      );
      expect(setGitHubRepoValueMock).not.toHaveBeenCalledWith(
        'variable',
        'DATABASE_AUTH_TOKEN_SSM',
        expect.anything(),
        expect.anything()
      );

      expect(result.secrets).toEqual(
        expect.arrayContaining([
          'SONAR_TOKEN',
          'STRYKER_DASHBOARD_API_KEY',
          'GITLEAKS_LICENSE',
          'AWS_ROLE_TO_ASSUME',
        ])
      );
      expect(result.variables).toEqual(
        expect.arrayContaining([
          'AWS_REGION',
          'LIFESTYLE_DATABASE_URL',
          'LIFESTYLE_DATABASE_AUTH_TOKEN_SSM',
        ])
      );
      expect(result.variables).not.toContain('AWS_STACK_NAME');
      expect(result.variables).not.toContain('DATABASE_URL');
      expect(result.variables).not.toContain('DATABASE_AUTH_TOKEN_SSM');
    });

    it('respects --skip-secrets, --skip-oidc, and --skip-db', async () => {
      const setupOidcMock = vi.fn().mockResolvedValue();
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
        },
        {
          setupOidc: setupOidcMock,
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setGitHubRepoValueMock).not.toHaveBeenCalled();
      expect(setupOidcMock).not.toHaveBeenCalled();
      expect(setSsmTokenMock).not.toHaveBeenCalled();
      expect(result.secrets).toEqual([]);
      expect(result.variables).toEqual([]);
    });

    it('handles unauthenticated or missing GitHub CLI gracefully', async () => {
      const setupOidcMock = vi.fn().mockResolvedValue();
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn();

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          sonarToken: 'secret',
          databaseUrl: 'libsql://example.com',
          databaseAuthToken: 'token',
        },
        {
          setupOidc: setupOidcMock,
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(false),
          checkGitHubAuth: vi.fn().mockReturnValue(false),
        }
      );

      // GitHub secrets/vars should not be set
      expect(setGitHubRepoValueMock).not.toHaveBeenCalled();
      // OIDC and SSM are still called
      expect(setupOidcMock).toHaveBeenCalled();
      expect(setSsmTokenMock).toHaveBeenCalled();
      expect(result.secrets).toEqual(['AWS_ROLE_TO_ASSUME']);
      expect(result.variables).toEqual(['AWS_REGION']);
    });

    it('catches and warns on OIDC and DB errors without aborting entire flow', async () => {
      const setupOidcMock = vi.fn().mockRejectedValue(new Error('IAM Permission Denied'));
      const setSsmTokenMock = vi.fn().mockRejectedValue(new Error('SSM Access Denied'));
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          sonarToken: 'sonar-val',
          databaseUrl: 'libsql://my.turso.io',
          databaseAuthToken: 'token-val',
        },
        {
          setupOidc: setupOidcMock,
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(result.secrets).toContain('SONAR_TOKEN');
      expect(setupOidcMock).toHaveBeenCalled();
      expect(setSsmTokenMock).toHaveBeenCalled();
    });

    it('handles dry-run mode properly', async () => {
      const setupOidcMock = vi.fn().mockResolvedValue();
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          sonarToken: 'dry-sonar',
          databaseUrl: 'libsql://dry.turso.io',
          databaseAuthToken: 'dry-token',
          dryRun: true,
        },
        {
          setupOidc: setupOidcMock,
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setupOidcMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
      expect(setSsmTokenMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ dryRun: true }),
        expect.any(Function),
        expect.any(Function)
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'secret',
        'SONAR_TOKEN',
        'dry-sonar',
        true
      );
      expect(result.secrets).toContain('SONAR_TOKEN');
    });

    it('configures AI API key in SSM and sets GitHub repo variables when aiApiKey is provided', async () => {
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
          aiApiKey: 'gemini-secret-key-123',
        },
        {
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setSsmTokenMock).toHaveBeenCalledWith(
        '/test-repo/ai/gemini-api-key',
        'gemini-secret-key-123',
        expect.objectContaining({ region: 'us-east-1', dryRun: false }),
        expect.any(Function),
        expect.any(Function)
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_AI_API_KEY_SSM',
        '/test-repo/ai/gemini-api-key',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_ENABLE_AI_FEATURES',
        'true',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_AI_PROVIDER',
        'cloud',
        false
      );
      expect(setGitHubRepoValueMock).not.toHaveBeenCalledWith(
        'variable',
        'AI_API_KEY_SSM',
        expect.anything(),
        expect.anything()
      );
      expect(setGitHubRepoValueMock).not.toHaveBeenCalledWith(
        'variable',
        'ENABLE_AI_FEATURES',
        expect.anything(),
        expect.anything()
      );
      expect(setGitHubRepoValueMock).not.toHaveBeenCalledWith(
        'variable',
        'AI_PROVIDER',
        expect.anything(),
        expect.anything()
      );
      expect(result.secrets).toContain('AI_API_KEY');
      expect(result.variables).toContain('LIFESTYLE_AI_API_KEY_SSM');
      expect(result.variables).toContain('LIFESTYLE_ENABLE_AI_FEATURES');
      expect(result.variables).toContain('LIFESTYLE_AI_PROVIDER');
      expect(result.variables).not.toContain('AI_API_KEY_SSM');
      expect(result.variables).not.toContain('ENABLE_AI_FEATURES');
      expect(result.variables).not.toContain('AI_PROVIDER');
    });

    it('supports custom aiApiKeySsm and profile prefixes in AI bootstrap', async () => {
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          eventProfile: 'lifestyle',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
          aiApiKey: 'my-custom-key',
          aiApiKeySsm: '/wishboard/ai/lifestyle-key',
          enableAi: false,
          aiProvider: 'noop',
        },
        {
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setSsmTokenMock).toHaveBeenCalledWith(
        '/wishboard/ai/lifestyle-key',
        'my-custom-key',
        expect.objectContaining({ region: 'us-east-1', dryRun: false }),
        expect.any(Function),
        expect.any(Function)
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_AI_API_KEY_SSM',
        '/wishboard/ai/lifestyle-key',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_ENABLE_AI_FEATURES',
        'false',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_AI_PROVIDER',
        'noop',
        false
      );
      expect(result.variables).toContain('LIFESTYLE_AI_API_KEY_SSM');
      expect(result.variables).toContain('LIFESTYLE_ENABLE_AI_FEATURES');
      expect(result.variables).toContain('LIFESTYLE_AI_PROVIDER');
    });

    it('skips AI setup when skipAi is true', async () => {
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
          skipAi: true,
          aiApiKey: 'gemini-key',
        },
        {
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setSsmTokenMock).not.toHaveBeenCalled();
      expect(result.secrets).not.toContain('AI_API_KEY');
    });

    it('gracefully skips AI setup when no AI key is provided', async () => {
      const setSsmTokenMock = vi.fn().mockResolvedValue(true);
      const setGitHubRepoValueMock = vi.fn().mockReturnValue(true);

      const result = await runBootstrap(
        {
          org: 'test-org',
          repo: 'test-repo',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
        },
        {
          setSsmToken: setSsmTokenMock,
          setGitHubRepoValue: setGitHubRepoValueMock,
          hasCommand: vi.fn().mockReturnValue(true),
          checkGitHubAuth: vi.fn().mockReturnValue(true),
        }
      );

      expect(setSsmTokenMock).not.toHaveBeenCalled();
      expect(result.secrets).not.toContain('AI_API_KEY');
    });
  });

  describe('resolveRepoInfo partial detection', () => {
    it('fills only the missing half from git info and throws the exact message', () => {
      const spy = vi
        .spyOn(commandUtils, 'getGitRepoInfo')
        .mockReturnValue({ org: 'git-org', repo: 'git-repo' });
      expect(resolveRepoInfo({ org: 'my-org' })).toEqual({
        org: 'my-org',
        repo: 'git-repo',
        region: 'us-east-1',
      });
      expect(resolveRepoInfo({ repo: 'my-repo' })).toEqual({
        org: 'git-org',
        repo: 'my-repo',
        region: 'us-east-1',
      });
      spy.mockReturnValue(null);
      expect(() => resolveRepoInfo({ org: 'only-org' })).toThrowError(
        new Error(
          'Could not detect GitHub repository from Git remote or package.json repository field. Please provide --org and --repo.'
        )
      );
      spy.mockRestore();
    });
  });

  describe('provisionTursoDatabase branch table', () => {
    beforeEach(() => {
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_AUTH_TOKEN;
    });

    it('creates only a token when the URL is already known', () => {
      const exec = vi.fn().mockReturnValue({ status: 0, stdout: 'fresh-token\n', stderr: '' });
      const res = provisionTursoDatabase(
        'mydb',
        { databaseUrl: 'libsql://known.turso.io' },
        { execCommand: exec, hasCommand: vi.fn().mockReturnValue(true) }
      );
      expect(res).toEqual({
        url: 'libsql://known.turso.io',
        token: 'fresh-token',
        provisioned: true,
      });
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith('turso', ['db', 'tokens', 'create', 'mydb'], {
        stdio: 'pipe',
      });
    });

    it('resolves only the URL when a token is already known', () => {
      const exec = vi
        .fn()
        .mockReturnValue({ status: 0, stdout: 'libsql://found.turso.io\n', stderr: '' });
      const res = provisionTursoDatabase(
        'mydb',
        { databaseAuthToken: 'known-token' },
        { execCommand: exec, hasCommand: vi.fn().mockReturnValue(true) }
      );
      expect(res).toEqual({
        url: 'libsql://found.turso.io',
        token: 'known-token',
        provisioned: true,
      });
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith('turso', ['db', 'show', 'mydb', '--url'], {
        stdio: 'pipe',
      });
    });

    it('option URL wins over the env URL; env token fills a missing option token', () => {
      process.env.DATABASE_URL = 'libsql://env.turso.io';
      process.env.DATABASE_AUTH_TOKEN = 'env-token';
      const exec = vi.fn();
      const res = provisionTursoDatabase(
        'mydb',
        { databaseUrl: 'libsql://option.turso.io' },
        { execCommand: exec, hasCommand: vi.fn().mockReturnValue(true) }
      );
      expect(res).toEqual({
        url: 'libsql://option.turso.io',
        token: 'env-token',
        provisioned: false,
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('dry run keeps a preset URL and substitutes the dry-run token', () => {
      const exec = vi.fn();
      const res = provisionTursoDatabase(
        'mydb',
        { databaseUrl: 'libsql://preset.turso.io', dryRun: true },
        { execCommand: exec, hasCommand: vi.fn().mockReturnValue(true) }
      );
      expect(res).toEqual({
        url: 'libsql://preset.turso.io',
        token: 'dry-run-turso-token',
        provisioned: true,
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('creates the database when show succeeds but prints only whitespace', () => {
      const exec = vi
        .fn()
        .mockReturnValueOnce({ status: 0, stdout: '  \n', stderr: '' })
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
        .mockReturnValueOnce({ status: 0, stdout: 'libsql://created.turso.io\n', stderr: '' })
        .mockReturnValueOnce({ status: 0, stdout: 'created-token\n', stderr: '' });
      const res = provisionTursoDatabase(
        'newdb',
        {},
        { execCommand: exec, hasCommand: vi.fn().mockReturnValue(true) }
      );
      expect(res).toEqual({
        url: 'libsql://created.turso.io',
        token: 'created-token',
        provisioned: true,
      });
      expect(exec.mock.calls.map((c) => c[1])).toEqual([
        ['db', 'show', 'newdb', '--url'],
        ['db', 'create', 'newdb'],
        ['db', 'show', 'newdb', '--url'],
        ['db', 'tokens', 'create', 'newdb'],
      ]);
    });

    it('throws the exact errors when create or token creation fails', () => {
      const createFail = vi
        .fn()
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'create boom' });
      expect(() =>
        provisionTursoDatabase(
          'mydb',
          {},
          { execCommand: createFail, hasCommand: vi.fn().mockReturnValue(true) }
        )
      ).toThrowError(new Error("Failed to create Turso database 'mydb': create boom"));

      const tokenFail = vi
        .fn()
        .mockReturnValueOnce({ status: 0, stdout: 'libsql://x.turso.io\n', stderr: '' })
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'token boom' });
      expect(() =>
        provisionTursoDatabase(
          'mydb',
          {},
          { execCommand: tokenFail, hasCommand: vi.fn().mockReturnValue(true) }
        )
      ).toThrowError(new Error("Failed to generate Turso token for 'mydb': token boom"));
    });

    it('without the turso CLI it returns whatever it was given, unprovisioned', () => {
      const noTurso = { execCommand: vi.fn(), hasCommand: vi.fn().mockReturnValue(false) };
      expect(provisionTursoDatabase('mydb', { databaseUrl: 'libsql://u' }, noTurso)).toEqual({
        url: 'libsql://u',
        token: '',
        provisioned: false,
      });
      expect(provisionTursoDatabase('mydb', { databaseAuthToken: 't' }, noTurso)).toEqual({
        url: '',
        token: 't',
        provisioned: false,
      });
      expect(provisionTursoDatabase('mydb', {}, noTurso)).toEqual({
        url: '',
        token: '',
        provisioned: false,
      });
    });
  });

  describe('runBootstrap exact output and branch table', () => {
    const logLines = () => vi.mocked(console.log).mock.calls.map((c) => c[0]);
    const warnLines = () => vi.mocked(console.warn).mock.calls.map((c) => c[0]);
    const ghDeps = (overrides = {}) => ({
      hasCommand: vi.fn().mockReturnValue(true),
      checkGitHubAuth: vi.fn().mockReturnValue(true),
      setGitHubRepoValue: vi.fn().mockReturnValue(true),
      setupOidc: vi.fn().mockResolvedValue(undefined),
      setSsmToken: vi.fn().mockResolvedValue(true),
      execCommand: vi.fn(),
      ...overrides,
    });

    beforeEach(() => {
      delete process.env.SONAR_TOKEN;
      delete process.env.STRYKER_DASHBOARD_API_KEY;
      delete process.env.GITLEAKS_LICENSE;
      delete process.env.AI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.AI_API_KEY_SSM;
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_AUTH_TOKEN;
    });

    it('full happy path: exact configured result, summary lines, and call args', async () => {
      const deps = ghDeps();
      const result = await runBootstrap(
        {
          org: 'myorg',
          repo: 'myrepo',
          region: 'eu-west-1',
          eventProfile: 'dev',
          sonarToken: 's1',
          strykerKey: 's2',
          gitleaksLicense: 's3',
          databaseUrl: 'libsql://db.turso.io',
          databaseAuthToken: 'dbtok',
          aiApiKey: 'aikey',
        },
        deps
      );
      expect(result).toEqual({
        secrets: [
          'SONAR_TOKEN',
          'STRYKER_DASHBOARD_API_KEY',
          'GITLEAKS_LICENSE',
          'AWS_ROLE_TO_ASSUME',
          'AI_API_KEY',
        ],
        variables: [
          'AWS_REGION',
          'DEV_DATABASE_URL',
          'DEV_DATABASE_AUTH_TOKEN_SSM',
          'DEV_AI_API_KEY_SSM',
          'DEV_ENABLE_AI_FEATURES',
          'DEV_AI_PROVIDER',
        ],
      });
      const lines = logLines();
      expect(lines).toContain('\n\x1b[32mWishboard Fork & Site Bootstrapper\x1b[0m');
      expect(lines).toContain('    Repository:    myorg/myrepo');
      expect(lines).toContain('    AWS Region:    eu-west-1');
      expect(lines).toContain('    Event Profile: dev');
      expect(lines).toContain('');
      expect(lines).toContain(
        '    Configured Secrets:   SONAR_TOKEN, STRYKER_DASHBOARD_API_KEY, GITLEAKS_LICENSE, AWS_ROLE_TO_ASSUME, AI_API_KEY'
      );
      expect(lines).toContain(
        '    Configured Variables: AWS_REGION, DEV_DATABASE_URL, DEV_DATABASE_AUTH_TOKEN_SSM, DEV_AI_API_KEY_SSM, DEV_ENABLE_AI_FEATURES, DEV_AI_PROVIDER'
      );
      expect(lines).toContain(
        '    Deploy your serverless stack: npx wishboard serverless deploy --event-profile dev'
      );
      expect(lines).toContain(
        '    Or deploy to a Raspberry Pi:  npx wishboard kiosk deploy --host raspberrypi.local\n'
      );
      expect(deps.setupOidc).toHaveBeenCalledWith({
        org: 'myorg',
        repo: 'myrepo',
        region: 'eu-west-1',
        dryRun: false,
      });
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith(
        'secret',
        'GITLEAKS_LICENSE',
        's3',
        false,
        'dependabot'
      );
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith(
        'variable',
        'DEV_ENABLE_AI_FEATURES',
        'true',
        false
      );
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith(
        'variable',
        'DEV_AI_PROVIDER',
        'cloud',
        false
      );
      expect(deps.setSsmToken.mock.calls[0].slice(0, 3)).toEqual([
        '/myrepo/dev/database-auth-token',
        'dbtok',
        { region: 'eu-west-1', dryRun: false },
      ]);
      expect(deps.setSsmToken.mock.calls[1].slice(0, 3)).toEqual([
        '/myrepo/ai/gemini-api-key',
        'aikey',
        { region: 'eu-west-1', dryRun: false },
      ]);
    });

    it('all four skip flags: exact step lines and an empty (none) summary', async () => {
      const deps = ghDeps();
      const result = await runBootstrap(
        {
          org: 'o',
          repo: 'r',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
          skipAi: true,
        },
        deps
      );
      expect(result).toEqual({ secrets: [], variables: [] });
      const lines = logLines();
      expect(lines).toContain(
        '\x1b[36m==> [1/4] Skipping CI/CD scanner secrets (--skip-secrets).\x1b[0m'
      );
      expect(lines).toContain(
        '\x1b[36m==> [2/4] Skipping AWS OIDC role provisioning (--skip-oidc).\x1b[0m'
      );
      expect(lines).toContain(
        '\x1b[36m==> [3/4] Skipping Turso database and SSM setup (--skip-db).\x1b[0m'
      );
      expect(lines).toContain('\x1b[36m==> [4/4] Skipping AI setup (--skip-ai).\x1b[0m');
      expect(lines).toContain('    Configured Secrets:   (none)');
      expect(lines).toContain('    Configured Variables: (none)');
      expect(deps.setupOidc).not.toHaveBeenCalled();
      expect(deps.setGitHubRepoValue).not.toHaveBeenCalled();
    });

    it('gh missing: warns exactly, never checks auth, and skips secret registration', async () => {
      const deps = ghDeps({ hasCommand: vi.fn().mockReturnValue(false) });
      await runBootstrap(
        { org: 'o', repo: 'r', sonarToken: 's1', skipOidc: true, skipDb: true, skipAi: true },
        deps
      );
      expect(deps.checkGitHubAuth).not.toHaveBeenCalled();
      expect(warnLines()).toContain(
        '\x1b[33mWARNING: GitHub CLI (gh) is not authenticated or not installed. Automatic secret registration will be skipped.\x1b[0m'
      );
      expect(logLines()).toContain(
        '    Skipping GitHub secret registration (gh not authenticated).'
      );
      expect(deps.setGitHubRepoValue).not.toHaveBeenCalled();
    });

    it('omitted scanner secrets log their exact guidance lines', async () => {
      const deps = ghDeps();
      await runBootstrap({ org: 'o', repo: 'r', skipOidc: true, skipDb: true, skipAi: true }, deps);
      const lines = logLines();
      expect(lines).toContain(
        '    SONAR_TOKEN omitted (pass --sonar-token or set $SONAR_TOKEN to configure SonarCloud).'
      );
      expect(lines).toContain(
        '    STRYKER_DASHBOARD_API_KEY omitted (pass --stryker-key or set $STRYKER_DASHBOARD_API_KEY to configure Stryker).'
      );
      expect(lines).toContain(
        '    GITLEAKS_LICENSE omitted (pass --gitleaks-license or set $GITLEAKS_LICENSE if using an organization fork).'
      );
    });

    it('a failed setGh call keeps the secret out of the configured list', async () => {
      const deps = ghDeps({
        setGitHubRepoValue: vi.fn().mockReturnValue(false),
      });
      const result = await runBootstrap(
        { org: 'o', repo: 'r', sonarToken: 's1', skipOidc: true, skipDb: true, skipAi: true },
        deps
      );
      expect(result.secrets).toEqual([]);
    });

    it('OIDC failure warns with the error message and records no AWS entries', async () => {
      const deps = ghDeps({
        setupOidc: vi.fn().mockRejectedValue(new Error('oidc boom')),
      });
      const result = await runBootstrap(
        { org: 'o', repo: 'r', skipSecrets: true, skipDb: true, skipAi: true },
        deps
      );
      expect(warnLines()).toContain(
        '\x1b[33mWARNING: AWS OIDC setup encountered an error: oidc boom\x1b[0m'
      );
      expect(result.secrets).not.toContain('AWS_ROLE_TO_ASSUME');
      expect(result.variables).not.toContain('AWS_REGION');
    });

    it('database without a token warns, still sets the URL variables, and defaults the db name', async () => {
      const deps = ghDeps({
        hasCommand: vi.fn((name) => name === 'gh'),
      });
      const result = await runBootstrap(
        {
          org: 'o',
          repo: 'My_Repo',
          eventProfile: 'dev',
          databaseUrl: 'libsql://only-url.turso.io',
          skipSecrets: true,
          skipOidc: true,
          skipAi: true,
        },
        deps
      );
      expect(warnLines()).toContain(
        '\x1b[33mWARNING: No database auth token provided or generated. SSM token registration was skipped.\x1b[0m'
      );
      expect(result.variables).toEqual(['DEV_DATABASE_URL', 'DEV_DATABASE_AUTH_TOKEN_SSM']);
      expect(deps.setSsmToken).not.toHaveBeenCalled();
    });

    it('database with neither URL nor token logs the omitted line', async () => {
      const deps = ghDeps({ hasCommand: vi.fn((name) => name === 'gh') });
      await runBootstrap(
        { org: 'o', repo: 'r', skipSecrets: true, skipOidc: true, skipAi: true },
        deps
      );
      expect(logLines()).toContain(
        '    Database URL omitted (pass --database-url or install turso CLI to automatically provision a database).'
      );
    });

    it('AI key from GEMINI_API_KEY, enableAi=false stringified, provider override honored', async () => {
      process.env.GEMINI_API_KEY = 'gem-key';
      const deps = ghDeps();
      const result = await runBootstrap(
        {
          org: 'o',
          repo: 'r',
          eventProfile: 'prod',
          enableAi: false,
          aiProvider: 'local',
          skipSecrets: true,
          skipOidc: true,
          skipDb: true,
        },
        deps
      );
      expect(deps.setSsmToken.mock.calls[0].slice(0, 3)).toEqual([
        '/r/ai/gemini-api-key',
        'gem-key',
        { region: 'us-east-1', dryRun: false },
      ]);
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith(
        'variable',
        'PROD_ENABLE_AI_FEATURES',
        'false',
        false
      );
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith(
        'variable',
        'PROD_AI_PROVIDER',
        'local',
        false
      );
      expect(result.secrets).toContain('AI_API_KEY');
    });

    it('no AI key: exact skip step and omitted lines', async () => {
      const deps = ghDeps();
      await runBootstrap(
        { org: 'o', repo: 'r', skipSecrets: true, skipOidc: true, skipDb: true },
        deps
      );
      const lines = logLines();
      expect(lines).toContain(
        '\x1b[36m==> [4/4] Skipping AI API key setup (no key provided).\x1b[0m'
      );
      expect(lines).toContain(
        '    AI API key omitted (pass --ai-api-key or set $AI_API_KEY / $GEMINI_API_KEY to configure serverless AI).'
      );
    });

    it('dry run announces DRY RUN mode and passes dryRun through to setGh', async () => {
      const deps = ghDeps();
      await runBootstrap(
        {
          org: 'o',
          repo: 'r',
          dryRun: true,
          sonarToken: 's1',
          skipOidc: true,
          skipDb: true,
          skipAi: true,
        },
        deps
      );
      expect(logLines()).toContain(
        '    Mode:          DRY RUN (no external resources will be created)\n'
      );
      expect(deps.setGitHubRepoValue).toHaveBeenCalledWith('secret', 'SONAR_TOKEN', 's1', true);
      expect(deps.checkGitHubAuth).toHaveBeenCalledWith(true);
    });
  });
});

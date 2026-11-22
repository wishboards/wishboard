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
        'DATABASE_URL',
        'libsql://test.turso.io',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'DATABASE_AUTH_TOKEN_SSM',
        '/test-repo/lifestyle/database-auth-token',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'LIFESTYLE_DATABASE_URL',
        'libsql://test.turso.io',
        false
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
          'AWS_STACK_NAME',
          'DATABASE_URL',
          'DATABASE_AUTH_TOKEN_SSM',
          'LIFESTYLE_DATABASE_URL',
        ])
      );
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
      expect(result.variables).toEqual(['AWS_REGION', 'AWS_STACK_NAME']);
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
        'AI_API_KEY_SSM',
        '/test-repo/ai/gemini-api-key',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'ENABLE_AI_FEATURES',
        'true',
        false
      );
      expect(setGitHubRepoValueMock).toHaveBeenCalledWith(
        'variable',
        'AI_PROVIDER',
        'cloud',
        false
      );
      expect(result.secrets).toContain('AI_API_KEY');
      expect(result.variables).toContain('AI_API_KEY_SSM');
      expect(result.variables).toContain('ENABLE_AI_FEATURES');
      expect(result.variables).toContain('AI_PROVIDER');
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
});

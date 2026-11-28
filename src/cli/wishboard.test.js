import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock commands to avoid side effects
vi.mock('./commands/oidc.js', () => ({
  setupOidc: vi.fn(),
  destroyOidc: vi.fn(),
}));

vi.mock('./commands/serverless.js', () => ({
  deployServerless: vi.fn(),
  destroyServerless: vi.fn(),
}));

vi.mock('./commands/kiosk.js', () => ({
  deployKiosk: vi.fn(),
  setupKiosk: vi.fn(),
  runKiosk: vi.fn(),
}));

vi.mock('./commands/auth.js', () => ({
  generateAuthToken: vi.fn(),
}));

vi.mock('./commands/db.js', () => ({
  resetPassword: vi.fn().mockResolvedValue(true),
  resetRules: vi.fn().mockResolvedValue(true),
  setSsmToken: vi.fn().mockResolvedValue(true),
}));

vi.mock('./commands/build.js', () => ({
  downloadFonts: vi.fn().mockResolvedValue(),
  prepareProfile: vi.fn(),
}));

vi.mock('./commands/backup.js', () => ({
  createBackup: vi.fn().mockResolvedValue({ dir: 'd' }),
  restoreBackup: vi.fn().mockResolvedValue(true),
  verifyBackup: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('./commands/bootstrap.js', () => ({
  runBootstrap: vi.fn().mockResolvedValue({}),
}));

class ProcessExitError extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe('wishboard CLI entrypoint', () => {
  let originalArgv;
  let exitSpy;
  let errorSpy;
  let stdoutSpy;

  beforeEach(() => {
    originalArgv = process.argv;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      if (code === 0) {
        throw new ProcessExitError(code);
      }
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const runCLI = async (args) => {
    process.argv = ['node', 'wishboard.js', ...args];
    try {
      await import('./wishboard.js');
    } catch (err) {
      if (!(err instanceof ProcessExitError)) {
        throw err;
      }
    }
  };

  it('prints help output', async () => {
    await runCLI(['--help']);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: wishboard'));
  });

  it('routes to oidc setup command with options', async () => {
    const oidcModule = await import('./commands/oidc.js');
    await runCLI(['oidc', 'setup', '--org', 'my-org', '--repo', 'my-repo', '--dry-run']);
    expect(oidcModule.setupOidc).toHaveBeenCalledWith(
      expect.objectContaining({
        org: 'my-org',
        repo: 'my-repo',
        dryRun: true,
      })
    );
  });

  it('handles errors in oidc setup action', async () => {
    const oidcModule = await import('./commands/oidc.js');
    vi.mocked(oidcModule.setupOidc).mockImplementationOnce(() => {
      throw new Error('Setup Failed');
    });
    await runCLI(['oidc', 'setup']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during setup: Setup Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to oidc destroy command with options', async () => {
    const oidcModule = await import('./commands/oidc.js');
    await runCLI(['oidc', 'destroy', '--org', 'my-org', '--repo', 'my-repo', '--dry-run']);
    expect(oidcModule.destroyOidc).toHaveBeenCalledWith(
      expect.objectContaining({
        org: 'my-org',
        repo: 'my-repo',
        dryRun: true,
      })
    );
  });

  it('handles errors in oidc destroy action', async () => {
    const oidcModule = await import('./commands/oidc.js');
    vi.mocked(oidcModule.destroyOidc).mockImplementationOnce(() => {
      throw new Error('Destroy Failed');
    });
    await runCLI(['oidc', 'destroy']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during destroy: Destroy Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to serverless deploy command with options', async () => {
    const mod = await import('./commands/serverless.js');
    await runCLI([
      'serverless',
      'deploy',
      '--mode',
      'dev',
      '--stack-name',
      'my-stack',
      '--dry-run',
    ]);
    expect(mod.deployServerless).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dev', stackName: 'my-stack', dryRun: true })
    );
  });

  it('handles errors in serverless deploy action', async () => {
    const mod = await import('./commands/serverless.js');
    vi.mocked(mod.deployServerless).mockImplementationOnce(() => {
      throw new Error('Deploy Failed');
    });
    await runCLI(['serverless', 'deploy']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during deploy: Deploy Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to serverless destroy command with options', async () => {
    const mod = await import('./commands/serverless.js');
    await runCLI(['serverless', 'destroy', '--force', '--dry-run']);
    expect(mod.destroyServerless).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, dryRun: true })
    );
  });

  it('handles errors in serverless destroy action', async () => {
    const mod = await import('./commands/serverless.js');
    vi.mocked(mod.destroyServerless).mockImplementationOnce(() => {
      throw new Error('Destroy Failed');
    });
    await runCLI(['serverless', 'destroy']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during destroy: Destroy Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to kiosk deploy command with options', async () => {
    const mod = await import('./commands/kiosk.js');
    await runCLI([
      'kiosk',
      'deploy',
      '--host',
      'mypi.local',
      '--mode',
      'prod',
      '--enable-ai',
      '--ai-provider',
      'local',
      '--dry-run',
    ]);
    expect(mod.deployKiosk).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mypi.local',
        mode: 'prod',
        enableAi: true,
        aiProvider: 'local',
        dryRun: true,
      })
    );
  });

  it('handles errors in kiosk deploy action', async () => {
    const mod = await import('./commands/kiosk.js');
    vi.mocked(mod.deployKiosk).mockImplementationOnce(() => {
      throw new Error('Kiosk Deploy Failed');
    });
    await runCLI(['kiosk', 'deploy']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during kiosk deploy: Kiosk Deploy Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to kiosk setup command with options', async () => {
    const mod = await import('./commands/kiosk.js');
    await runCLI(['kiosk', 'setup', '--mode', 'dual', '--dry-run']);
    expect(mod.setupKiosk).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dual', dryRun: true })
    );
  });

  it('handles errors in kiosk setup action', async () => {
    const mod = await import('./commands/kiosk.js');
    vi.mocked(mod.setupKiosk).mockImplementationOnce(() => {
      throw new Error('Kiosk Setup Failed');
    });
    await runCLI(['kiosk', 'setup']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during kiosk setup: Kiosk Setup Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to kiosk run command with options', async () => {
    const mod = await import('./commands/kiosk.js');
    await runCLI(['kiosk', 'run', '--reset-rules', '--enable-ai', '--dry-run']);
    expect(mod.runKiosk).toHaveBeenCalledWith(
      expect.objectContaining({ resetRules: true, enableAi: true, dryRun: true })
    );
  });

  it('handles errors in kiosk run action', async () => {
    const mod = await import('./commands/kiosk.js');
    vi.mocked(mod.runKiosk).mockImplementationOnce(() => {
      throw new Error('Kiosk Run Failed');
    });
    await runCLI(['kiosk', 'run']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during kiosk run: Kiosk Run Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to db reset-password command', async () => {
    const dbModule = await import('./commands/db.js');
    await runCLI(['db', 'reset-password', 'testuser', 'newpass123']);
    expect(dbModule.resetPassword).toHaveBeenCalledWith(
      'testuser',
      'newpass123',
      expect.anything()
    );
  });

  it('routes to build download-fonts command', async () => {
    const buildModule = await import('./commands/build.js');
    await runCLI(['build', 'download-fonts']);
    expect(buildModule.downloadFonts).toHaveBeenCalled();
  });

  it('routes to auth token command with options', async () => {
    const authModule = await import('./commands/auth.js');
    await runCLI([
      'auth',
      'token',
      'adminuser',
      '--url',
      'my-url',
      '--passphrase',
      'my-passphrase',
      '--dry-run',
    ]);
    expect(authModule.generateAuthToken).toHaveBeenCalledWith(
      'adminuser',
      expect.objectContaining({
        url: 'my-url',
        passphrase: 'my-passphrase',
        dryRun: true,
      })
    );
  });

  it('handles errors in auth token action', async () => {
    const authModule = await import('./commands/auth.js');
    vi.mocked(authModule.generateAuthToken).mockImplementationOnce(() => {
      throw new Error('Auth Token Failed');
    });
    await runCLI(['auth', 'token', 'adminuser']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error generating token: Auth Token Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes db backup with target options and the default images dir', async () => {
    const mod = await import('./commands/backup.js');
    await runCLI([
      'db',
      'backup',
      '--database-url',
      'libsql://x',
      '--out',
      'o',
      '--verify',
      '--strict',
      '--keep',
      '7',
      '--copy-to',
      '/media/usb',
      '--archive-s3-bucket',
      'archive-bkt',
      '--archive-s3-prefix',
      'backups/lifestyle/',
      '--dry-run',
    ]);
    expect(mod.createBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseUrl: 'libsql://x',
        out: 'o',
        verify: true,
        strict: true,
        keep: '7',
        copyTo: '/media/usb',
        archiveS3Bucket: 'archive-bkt',
        archiveS3Prefix: 'backups/lifestyle/',
        dryRun: true,
        imagesDir: 'data/images',
      })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('exits non-zero when db backup fails', async () => {
    const mod = await import('./commands/backup.js');
    vi.mocked(mod.createBackup).mockResolvedValueOnce(null);
    await runCLI(['db', 'backup', '--s3-bucket', 'bkt']);
    expect(mod.createBackup).toHaveBeenCalledWith(expect.objectContaining({ s3Bucket: 'bkt' }));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes db restore with --force', async () => {
    const mod = await import('./commands/backup.js');
    await runCLI(['db', 'restore', 'some/dir', '--force', '--images-dir', 'imgs']);
    expect(mod.restoreBackup).toHaveBeenCalledWith(
      'some/dir',
      expect.objectContaining({ force: true, imagesDir: 'imgs' })
    );
  });

  it('exits non-zero when db restore throws', async () => {
    const mod = await import('./commands/backup.js');
    vi.mocked(mod.restoreBackup).mockRejectedValueOnce(new Error('Restore Failed'));
    await runCLI(['db', 'restore', 'some/dir']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during restore: Restore Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes db verify-backup', async () => {
    const mod = await import('./commands/backup.js');
    await runCLI(['db', 'verify-backup', 'some/dir', '--strict', '--latest']);
    expect(mod.verifyBackup).toHaveBeenCalledWith(
      'some/dir',
      expect.objectContaining({ strict: true, latest: true })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('exits non-zero when db verify-backup fails verification', async () => {
    const mod = await import('./commands/backup.js');
    vi.mocked(mod.verifyBackup).mockResolvedValueOnce({ ok: false });
    await runCLI(['db', 'verify-backup', 'bad/dir']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes to bootstrap command with options', async () => {
    const mod = await import('./commands/bootstrap.js');
    await runCLI([
      'bootstrap',
      '--org',
      'my-org',
      '--repo',
      'my-repo',
      '--sonar-token',
      'st-123',
      '--stryker-key',
      'sk-456',
      '--gitleaks-license',
      'gl-789',
      '--turso-db',
      'custom-db',
      '--dry-run',
    ]);
    expect(mod.runBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        org: 'my-org',
        repo: 'my-repo',
        sonarToken: 'st-123',
        strykerKey: 'sk-456',
        gitleaksLicense: 'gl-789',
        tursoDb: 'custom-db',
        dryRun: true,
      })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('exits non-zero when bootstrap fails', async () => {
    const mod = await import('./commands/bootstrap.js');
    vi.mocked(mod.runBootstrap).mockRejectedValueOnce(new Error('Bootstrap Failed'));
    await runCLI(['bootstrap']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during bootstrap: Bootstrap Failed')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('includes global options in subcommand help output', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCLI(['serverless', 'deploy', '--help']);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('Global Options:');
    expect(output).toContain('--dry-run');
    writeSpy.mockRestore();
  });

  it('routes db reset-rules with globals and the force flag', async () => {
    const mod = await import('./commands/db.js');
    await runCLI(['--event-profile', 'pro', 'db', 'reset-rules', '--force', '--dry-run']);
    expect(mod.resetRules).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, dryRun: true, eventProfile: 'pro' })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('db reset-rules exits 1 without an error message when resetRules returns false', async () => {
    const mod = await import('./commands/db.js');
    vi.mocked(mod.resetRules).mockResolvedValueOnce(false);
    await runCLI(['db', 'reset-rules']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('db reset-rules reports the exact error and exits 1 on failure', async () => {
    const mod = await import('./commands/db.js');
    vi.mocked(mod.resetRules).mockRejectedValueOnce(new Error('rules boom'));
    await runCLI(['db', 'reset-rules']);
    expect(errorSpy).toHaveBeenCalledWith('\x1b[31mError resetting rules: rules boom\x1b[0m');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('routes db set-ssm-token positionals with the default region', async () => {
    const mod = await import('./commands/db.js');
    await runCLI(['db', 'set-ssm-token', '/my/param', 'tok123']);
    expect(mod.setSsmToken).toHaveBeenCalledWith(
      '/my/param',
      'tok123',
      expect.objectContaining({ region: 'us-east-1' })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('routes db set-ssm-token with an explicit region', async () => {
    const mod = await import('./commands/db.js');
    await runCLI(['db', 'set-ssm-token', '/p', 't', '--region', 'eu-west-1']);
    expect(mod.setSsmToken).toHaveBeenCalledWith(
      '/p',
      't',
      expect.objectContaining({ region: 'eu-west-1' })
    );
  });

  it('db set-ssm-token reports the exact error and exits 1 on failure', async () => {
    const mod = await import('./commands/db.js');
    vi.mocked(mod.setSsmToken).mockRejectedValueOnce(new Error('ssm boom'));
    await runCLI(['db', 'set-ssm-token', '/p', 't']);
    expect(errorSpy).toHaveBeenCalledWith('\x1b[31mError setting SSM parameter: ssm boom\x1b[0m');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('propagates global dry-run and event-profile into oidc setup opts', async () => {
    const mod = await import('./commands/oidc.js');
    await runCLI(['--dry-run', '--event-profile', 'pro', 'oidc', 'setup']);
    expect(mod.setupOidc).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, eventProfile: 'pro', region: 'us-east-1' })
    );
  });

  it('routes build prepare-profile with the event profile as first arg', async () => {
    const mod = await import('./commands/build.js');
    await runCLI(['--event-profile', 'dev', 'build', 'prepare-profile']);
    expect(mod.prepareProfile).toHaveBeenCalledWith(
      'dev',
      expect.objectContaining({ eventProfile: 'dev' })
    );
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('build prepare-profile reports the exact error and exits 1 on failure', async () => {
    const mod = await import('./commands/build.js');
    vi.mocked(mod.prepareProfile).mockImplementationOnce(() => {
      throw new Error('profile boom');
    });
    await runCLI(['build', 'prepare-profile']);
    expect(errorSpy).toHaveBeenCalledWith('\x1b[31mError preparing profile: profile boom\x1b[0m');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('help output for db reset-rules lists its exact options and defaults', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCLI(['db', 'reset-rules', '--help']);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('Reset matching rules to bundled defaults (local or remote)');
    expect(output).toContain('--url <url>');
    expect(output).toContain('--admin <username>');
    expect(output).toContain('(default: "admin")');
    expect(output).toContain('--force');
    writeSpy.mockRestore();
  });

  it('help output for the root command lists every command group', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCLI(['--help']);
    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('Unified deployment and administration CLI for Wishboard');
    for (const group of ['oidc', 'bootstrap', 'serverless', 'kiosk', 'db', 'build', 'auth']) {
      expect(output).toContain(group);
    }
    writeSpy.mockRestore();
  });
});

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
}));

vi.mock('./commands/build.js', () => ({
  downloadFonts: vi.fn().mockResolvedValue(),
}));

vi.mock('./commands/backup.js', () => ({
  createBackup: vi.fn().mockResolvedValue({ dir: 'd' }),
  restoreBackup: vi.fn().mockResolvedValue(true),
  verifyBackup: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('wishboard CLI entrypoint', () => {
  let originalArgv;
  let exitSpy;
  let errorSpy;

  beforeEach(() => {
    originalArgv = process.argv;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const runCLI = async (args) => {
    process.argv = ['node', 'wishboard.js', ...args];
    await import('./wishboard.js');
  };

  it('prints help output', async () => {
    await runCLI(['--help']);
    expect(exitSpy).toHaveBeenCalledWith(0);
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
    await runCLI(['kiosk', 'deploy', '--host', 'mypi.local', '--mode', 'prod', '--dry-run']);
    expect(mod.deployKiosk).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mypi.local', mode: 'prod', dryRun: true })
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
    await runCLI(['kiosk', 'run', '--reset-rules', '--dry-run']);
    expect(mod.runKiosk).toHaveBeenCalledWith(
      expect.objectContaining({ resetRules: true, dryRun: true })
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

  it('includes global options in subcommand help output', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCLI(['serverless', 'deploy', '--help']);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('Global Options:');
    expect(output).toContain('--dry-run');
    writeSpy.mockRestore();
  });
});

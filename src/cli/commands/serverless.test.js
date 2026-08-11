import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deployServerless, destroyServerless } from './serverless.js';
import * as commandUtils from '../commandUtils.js';
import fs from 'node:fs';

vi.mock('../commandUtils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hasCommand: vi.fn(),
    execCommand: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ''),
  },
}));

// Default execCommand behaviour: succeed, returning stack outputs for describe-stacks.
function defaultExec(cmd, args = []) {
  const has = (s) => args.some((a) => String(a).includes(s));
  if (cmd === 'aws' && has('get-caller-identity')) {
    return { status: 0, stdout: '123456789012\n', stderr: '' };
  }
  if (cmd === 'aws' && has('s3') && has('ls')) {
    return { status: 1, stdout: '', stderr: 'NoSuchBucket\n' };
  }
  if (cmd === 'aws' && has('describe-stacks')) {
    if (has('FrontendBucketName')) return { status: 0, stdout: 'frontend-bucket\n', stderr: '' };
    if (has('CloudFrontDistributionId')) return { status: 0, stdout: 'DIST123\n', stderr: '' };
    if (has('CloudFrontUrl')) return { status: 0, stdout: 'https://cf.example\n', stderr: '' };
    if (has('CustomDomainUrl')) return { status: 0, stdout: 'None\n', stderr: '' };
    if (has('ImagesBucketName')) return { status: 0, stdout: 'images-bucket\n', stderr: '' };
    if (has('StackStatus')) return { status: 0, stdout: 'CREATE_COMPLETE\n', stderr: '' };
  }
  if (cmd === 'aws' && has('describe-stack-resource')) {
    return { status: 0, stdout: 'api-fn-physical\n', stderr: '' };
  }
  if (cmd === 'aws' && has('get-function-configuration')) {
    return { status: 0, stdout: JSON.stringify({ Environment: { Variables: {} } }), stderr: '' };
  }
  return { status: 0, stdout: '', stderr: '' };
}

describe('serverless commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
    vi.mocked(commandUtils.execCommand).mockImplementation(defaultExec);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('');
  });

  afterEach(() => {
    delete process.env.CI;
  });

  describe('deployServerless', () => {
    it('throws if the AWS CLI is missing', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd !== 'aws');
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'aws missing'
      );
    });

    it('rejects parameter override values containing unsafe characters', () => {
      process.env.DOMAIN_NAME = 'evil.com; rm -rf /';
      try {
        expect(() =>
          deployServerless({ mode: 'dev', stackName: 'wishboard-serverless-dev', dryRun: true })
        ).toThrow(/Invalid value for DomainName/);
      } finally {
        delete process.env.DOMAIN_NAME;
      }
    });

    it('throws if AWS authentication fails', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws' && args.includes('get-caller-identity')) {
          return { status: 1, stdout: '', stderr: 'no creds' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'Unable to authenticate to AWS'
      );
    });

    it('runs the full pipeline: build, sam build, post-build, deploy, upload, invalidate', () => {
      deployServerless({ stackName: 'wishboard-serverless-dev', region: 'us-east-1', mode: 'dev' });

      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.objectContaining({ dryRun: false })
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'sam',
        ['build'],
        expect.objectContaining({ dryRun: false })
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'node',
        ['post-build.js'],
        expect.objectContaining({ dryRun: false })
      );

      // sam deploy with non-guided flags + dev NodeEnv override + tags
      const deployCall = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'sam' && c[1][0] === 'deploy');
      expect(deployCall).toBeDefined();
      expect(deployCall[1]).toEqual(
        expect.arrayContaining([
          'deploy',
          '--stack-name',
          'wishboard-serverless-dev',
          '--no-confirm-changeset',
          '--capabilities',
          'CAPABILITY_IAM',
          '--resolve-s3',
          '--region',
          'us-east-1',
        ])
      );
      expect(deployCall[1]).not.toContain('--guided');

      // Parameter overrides are one quoted string; empty optional params stay quoted.
      const povValue = deployCall[1][deployCall[1].indexOf('--parameter-overrides') + 1];
      expect(povValue).toContain("ProjectName='wishboard-dev'");
      expect(povValue).toContain("NodeEnv='development'");
      expect(povValue).toContain("DomainName=''");

      // frontend upload + invalidation
      const syncCalls = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.filter((c) => c[0] === 'aws' && c[1].includes('sync'));
      expect(syncCalls.length).toBe(3);

      // First sync (root files excluding assets and fonts)
      expect(syncCalls[0][1]).toEqual(
        expect.arrayContaining([
          's3',
          'sync',
          '--exclude',
          'assets/*',
          '--exclude',
          'fonts/*',
          '--delete',
          '--cache-control',
          'no-cache, no-store, must-revalidate',
        ])
      );

      // Second sync (assets)
      expect(syncCalls[1][1]).toEqual(
        expect.arrayContaining([
          's3',
          'sync',
          '--delete',
          '--cache-control',
          'public, max-age=31536000, immutable',
        ])
      );

      // Third sync (fonts)
      expect(syncCalls[2][1]).toEqual(
        expect.arrayContaining([
          's3',
          'sync',
          '--delete',
          '--cache-control',
          'public, max-age=31536000',
        ])
      );

      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining([
          'cloudfront',
          'create-invalidation',
          '--distribution-id',
          'DIST123',
        ]),
        expect.any(Object)
      );
    });

    it('reads stack outputs from the explicit --stack-name, not samconfig, on a non-guided deploy', () => {
      // samconfig.toml exists (non-guided) and names a different stack.
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('stack_name = "wishboard-serverless"\n');

      deployServerless({
        stackName: 'wishboard-serverless-dev',
        region: 'us-east-1',
        skipFrontendUpload: true,
      });

      const describeCalls = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.filter((c) => c[0] === 'aws' && c[1].includes('describe-stacks'));
      expect(describeCalls.length).toBeGreaterThan(0);
      for (const c of describeCalls) {
        const nameArg = c[1][c[1].indexOf('--stack-name') + 1];
        expect(nameArg).toBe('wishboard-serverless-dev');
      }
    });

    it('uses --guided when no samconfig.toml exists and CI is unset', () => {
      delete process.env.CI;
      vi.mocked(fs.existsSync).mockReturnValue(false); // no samconfig.toml, no dist check issues
      // dist check only runs in non-dryRun upload; skip upload to avoid dist existsSync=false throw
      deployServerless({ stackName: 'wishboard-serverless-dev', skipFrontendUpload: true });

      const deployCall = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'sam' && c[1][0] === 'deploy');
      expect(deployCall[1]).toContain('--guided');
    });

    it('with --frontend-only, skips sam build/deploy but still uploads', () => {
      deployServerless({ stackName: 'wishboard-serverless-dev', frontendOnly: true });

      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.any(Object)
      );
      const samBuild = vi.mocked(commandUtils.execCommand).mock.calls.find((c) => c[0] === 'sam');
      expect(samBuild).toBeUndefined();
      // still uploads
      expect(
        vi.mocked(commandUtils.execCommand).mock.calls.some((c) => c[1].includes('sync'))
      ).toBe(true);
    });

    it('honours --dry-run by passing dryRun through to execCommand', () => {
      deployServerless({ stackName: 'wishboard-serverless-dev', dryRun: true });
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.objectContaining({ dryRun: true })
      );
    });

    // Helper: locate the `sam deploy` invocation and its --parameter-overrides value.
    const findDeploy = () =>
      vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find((c) => c[0] === 'sam' && c[1][0] === 'deploy');
    const overridesOf = (deployCall) =>
      deployCall[1][deployCall[1].indexOf('--parameter-overrides') + 1];

    it('uses production NodeEnv and the undecorated ProjectName in prod mode', () => {
      deployServerless({
        stackName: 'wishboard-serverless',
        mode: 'prod',
        skipFrontendUpload: true,
      });
      const pov = overridesOf(findDeploy());
      expect(pov).toContain("NodeEnv='production'");
      expect(pov).toContain("ProjectName='wishboard'");
      expect(pov).not.toContain("ProjectName='wishboard-dev'");
    });

    it('derives ProjectName dynamically from stackName for custom stacks', () => {
      deployServerless({
        stackName: 'wishboard-serverless-conference',
        mode: 'dev',
        skipFrontendUpload: true,
      });
      const pov = overridesOf(findDeploy());
      expect(pov).toContain("ProjectName='wishboard-conference-dev'");
    });

    it('uses explicit projectName option when provided', () => {
      deployServerless({
        stackName: 'wishboard-serverless-conference',
        projectName: 'my-custom-app',
        mode: 'dev',
        skipFrontendUpload: true,
      });
      const pov = overridesOf(findDeploy());
      expect(pov).toContain("ProjectName='my-custom-app-dev'");
    });

    it('takes ProjectName and domain params from environment variables', () => {
      process.env.PROJECT_NAME = 'custom-proj';
      process.env.DOMAIN_NAME = 'example.com';
      process.env.HOSTED_ZONE_ID = 'Z123ABC';
      process.env.ACM_CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:1:certificate/abc-123';
      try {
        deployServerless({ stackName: 'wishboard-serverless-dev', dryRun: true });
        const pov = overridesOf(findDeploy());
        expect(pov).toContain("ProjectName='custom-proj'");
        expect(pov).toContain("DomainName='example.com'");
        expect(pov).toContain("HostedZoneId='Z123ABC'");
        expect(pov).toContain("AcmCertificateArn='arn:aws:acm:us-east-1:1:certificate/abc-123'");
      } finally {
        delete process.env.PROJECT_NAME;
        delete process.env.DOMAIN_NAME;
        delete process.env.HOSTED_ZONE_ID;
        delete process.env.ACM_CERTIFICATE_ARN;
      }
    });

    it('parses escaped-quote samconfig parameter_overrides so the domain is not blanked (regression #158)', () => {
      // SAM writes parameter_overrides with escaped inner quotes; the CLI must
      // parse these, or DomainName resolves empty and CloudFormation tears down
      // the custom domain (DNS + ACM cert).
      const samconfig = [
        'version = 0.1',
        '[default.deploy.parameters]',
        'stack_name = "wishboard-serverless-dev"',
        'parameter_overrides = "ProjectName=\\"wishboard\\" DomainName=\\"demo.wishboards.app\\" HostedZoneId=\\"Z07ABC\\" AcmCertificateArn=\\"arn:aws:acm:us-east-1:1:certificate/abc\\" NodeEnv=\\"development\\""',
      ].join('\n');
      vi.mocked(fs.readFileSync).mockReturnValue(samconfig);

      deployServerless({
        stackName: 'wishboard-serverless-dev',
        region: 'us-east-1',
        mode: 'dev',
        dryRun: true,
      });

      const pov = overridesOf(findDeploy());
      expect(pov).toContain("DomainName='demo.wishboards.app'");
      expect(pov).toContain("HostedZoneId='Z07ABC'");
      expect(pov).toContain("AcmCertificateArn='arn:aws:acm:us-east-1:1:certificate/abc'");
      expect(pov).not.toMatch(/(^|\s)DomainName=''/);
    });

    it('does not resolve a key from the tail of a longer key in parameter_overrides', () => {
      // "DomainName" is a suffix of "CustomDomainName". Without a token-boundary
      // anchor the unanchored match hits the longer key first and DomainName
      // resolves to the wrong value.
      const samconfig = [
        'version = 0.1',
        '[default.deploy.parameters]',
        'stack_name = "wishboard-serverless-dev"',
        'parameter_overrides = "ProjectName=\\"wishboard\\" CustomDomainName=\\"wrong.example.com\\" DomainName=\\"demo.wishboards.app\\" HostedZoneId=\\"Z07ABC\\" NodeEnv=\\"development\\""',
      ].join('\n');
      vi.mocked(fs.readFileSync).mockReturnValue(samconfig);

      deployServerless({
        stackName: 'wishboard-serverless-dev',
        region: 'us-east-1',
        mode: 'dev',
        dryRun: true,
      });

      const pov = overridesOf(findDeploy());
      expect(pov).toContain("DomainName='demo.wishboards.app'");
      expect(pov).not.toContain('wrong.example.com');
    });

    it('passes DatabaseUrl and DatabaseAuthTokenSsm from samconfig into the overrides', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        [
          'version = 0.1',
          '[default.deploy.parameters]',
          'stack_name = "wishboard-serverless-dev"',
          'parameter_overrides = "ProjectName=\\"wishboard-dev\\" DatabaseUrl=\\"libsql://db.turso.io\\" DatabaseAuthTokenSsm=\\"/wishboard/dev/turso-auth-token\\" NodeEnv=\\"development\\""',
        ].join('\n')
      );

      deployServerless({
        stackName: 'wishboard-serverless-dev',
        region: 'us-east-1',
        mode: 'dev',
        dryRun: true,
      });

      const pov = overridesOf(findDeploy());
      expect(pov).toContain("DatabaseUrl='libsql://db.turso.io'");
      expect(pov).toContain("DatabaseAuthTokenSsm='/wishboard/dev/turso-auth-token'");
    });

    it('reads stack_name, region, and profile from samconfig.toml when no CLI options given', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        'stack_name = "toml-stack-dev"\nregion = "eu-west-1"\nprofile = "toml-prof"\n'
      );
      deployServerless({ skipFrontendUpload: true });
      const deploy = findDeploy();
      expect(deploy[1][deploy[1].indexOf('--stack-name') + 1]).toBe('toml-stack-dev');
      expect(deploy[1]).toEqual(expect.arrayContaining(['--region', 'eu-west-1']));
      expect(deploy[1]).toEqual(expect.arrayContaining(['--profile', 'toml-prof']));
    });

    it('reads section-aware config and passes --config-env when eventProfile is provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        '[default.deploy.parameters]\nstack_name = "default-stack"\n\n[professional.deploy.parameters]\nstack_name = "wishboard-serverless-conference-dev"\n'
      );
      deployServerless({ eventProfile: 'professional', skipFrontendUpload: true });
      const deploy = findDeploy();
      expect(deploy[1][deploy[1].indexOf('--stack-name') + 1]).toBe(
        'wishboard-serverless-conference-dev'
      );
      expect(deploy[1]).toEqual(expect.arrayContaining(['--config-env', 'professional']));
    });

    it('defaults the stack name to wishboard-serverless when nothing is configured', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      deployServerless({ skipFrontendUpload: true, dryRun: true });
      const deploy = findDeploy();
      expect(deploy[1][deploy[1].indexOf('--stack-name') + 1]).toBe('wishboard-serverless');
    });

    it.each([
      ['npm', ['run', 'build'], 'Frontend build failed.'],
      ['sam', ['build'], 'sam build failed.'],
      ['node', ['post-build.js'], 'post-build.js failed.'],
    ])('throws when %s %j fails', (failCmd, failArgs, message) => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === failCmd && failArgs.every((a) => args.includes(a))) {
          return { status: 1, stdout: '', stderr: 'boom' };
        }
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(message);
    });

    it('retries sam deploy up to 4 times and succeeds if a retry succeeds', () => {
      let attempts = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'sam' && args[0] === 'deploy') {
          attempts++;
          if (attempts < 3) {
            return { status: 1, stdout: '', stderr: 'flaky upload error' };
          }
          return { status: 0, stdout: 'success', stderr: '' };
        }
        return defaultExec(cmd, args);
      });

      const sleepMock = vi.fn();
      deployServerless({
        stackName: 'wishboard-serverless-dev',
        region: 'us-east-1',
        mode: 'dev',
        skipFrontendUpload: true,
        sleep: sleepMock,
      });

      expect(attempts).toBe(3);
      expect(sleepMock).toHaveBeenCalledTimes(2);
      expect(sleepMock).toHaveBeenLastCalledWith(5000);
    });

    it('throws after 4 failed attempts of sam deploy', () => {
      let attempts = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'sam' && args[0] === 'deploy') {
          attempts++;
          return { status: 1, stdout: '', stderr: 'flaky upload error' };
        }
        return defaultExec(cmd, args);
      });

      const sleepMock = vi.fn();
      expect(() =>
        deployServerless({
          stackName: 'wishboard-serverless-dev',
          region: 'us-east-1',
          mode: 'dev',
          skipFrontendUpload: true,
          sleep: sleepMock,
        })
      ).toThrow('sam deploy failed after 4 attempt(s).');

      expect(attempts).toBe(4);
      expect(sleepMock).toHaveBeenCalledTimes(3);
    });

    it('never retries sam deploy in guided mode', () => {
      let attempts = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'sam' && args[0] === 'deploy') {
          attempts++;
          return { status: 1, stdout: '', stderr: 'guided mode fail' };
        }
        return defaultExec(cmd, args);
      });

      const sleepMock = vi.fn();
      // guided is triggered if samconfig.toml does not exist (existsSync returns false)
      vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('samconfig.toml'));

      expect(() =>
        deployServerless({
          stackName: 'wishboard-serverless-dev',
          region: 'us-east-1',
          mode: 'dev',
          skipFrontendUpload: true,
          sleep: sleepMock,
          guided: true,
        })
      ).toThrow('sam deploy failed after 1 attempt(s).');

      expect(attempts).toBe(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('never retries sam deploy in dry-run mode', () => {
      let attempts = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'sam' && args[0] === 'deploy') {
          attempts++;
          return { status: 1, stdout: '', stderr: 'dryrun fail' };
        }
        return defaultExec(cmd, args);
      });

      const sleepMock = vi.fn();
      expect(() =>
        deployServerless({
          stackName: 'wishboard-serverless-dev',
          region: 'us-east-1',
          mode: 'dev',
          skipFrontendUpload: true,
          sleep: sleepMock,
          dryRun: true,
        })
      ).toThrow('sam deploy failed after 1 attempt(s).');

      expect(attempts).toBe(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('throws if the FrontendBucketName stack output is missing', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (
          cmd === 'aws' &&
          args.includes('describe-stacks') &&
          args.some((a) => String(a).includes('FrontendBucketName'))
        ) {
          return { status: 0, stdout: 'None\n', stderr: '' };
        }
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'FrontendBucketName output not found'
      );
    });

    it('throws if the first S3 sync (root files) fails', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'aws' && args.includes('sync')) return { status: 1, stdout: '', stderr: 'x' };
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'Frontend root files upload to S3 failed.'
      );
    });

    it('throws if the second S3 sync (assets) fails', () => {
      let syncCount = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'aws' && args.includes('sync')) {
          syncCount++;
          if (syncCount === 2) {
            return { status: 1, stdout: '', stderr: 'x' };
          }
        }
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'Frontend assets upload to S3 failed.'
      );
    });

    it('throws if the third S3 sync (fonts) fails', () => {
      let syncCount = 0;
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'aws' && args.includes('sync')) {
          syncCount++;
          if (syncCount === 3) {
            return { status: 1, stdout: '', stderr: 'x' };
          }
        }
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'Frontend fonts upload to S3 failed.'
      );
    });

    it('throws if the CloudFront invalidation fails', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'aws' && args.includes('create-invalidation')) {
          return { status: 1, stdout: '', stderr: 'x' };
        }
        return defaultExec(cmd, args);
      });
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'CloudFront invalidation failed.'
      );
    });

    it('throws if the build output directory is missing at upload time', () => {
      // samconfig.toml exists (non-guided), but dist/ does not.
      vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('dist'));
      expect(() => deployServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'Build output not found'
      );
    });

    it('skips the upload entirely with --skip-frontend-upload', () => {
      deployServerless({ stackName: 'wishboard-serverless-dev', skipFrontendUpload: true });
      const uploaded = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.some((c) => c[1].includes('sync') || c[1].includes('create-invalidation'));
      expect(uploaded).toBe(false);
    });

    it('skips CloudFront steps when the stack has no distribution id', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (
          cmd === 'aws' &&
          args.includes('describe-stacks') &&
          args.some((a) => String(a).includes('CloudFrontDistributionId'))
        ) {
          return { status: 0, stdout: 'None\n', stderr: '' };
        }
        return defaultExec(cmd, args);
      });
      deployServerless({ stackName: 'wishboard-serverless-dev' });
      const calls = vi.mocked(commandUtils.execCommand).mock.calls;
      expect(calls.some((c) => c[1].includes('describe-stack-resource'))).toBe(false);
      expect(calls.some((c) => c[1].includes('create-invalidation'))).toBe(false);
    });

    it('updates the Lambda CLOUDFRONT_DISTRIBUTION_ID when it changed', () => {
      deployServerless({ stackName: 'wishboard-serverless-dev', skipFrontendUpload: true });
      const update = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find(
          (c) => c[1].includes('update-function-configuration') && c[1].includes('--environment')
        );
      expect(update).toBeDefined();
      expect(update[1][update[1].indexOf('--environment') + 1]).toContain('DIST123');
    });

    it('leaves the Lambda config untouched when the distribution id is already set', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'aws' && args.includes('get-function-configuration')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              Environment: { Variables: { CLOUDFRONT_DISTRIBUTION_ID: 'DIST123' } },
            }),
            stderr: '',
          };
        }
        return defaultExec(cmd, args);
      });
      deployServerless({ stackName: 'wishboard-serverless-dev', skipFrontendUpload: true });
      const update = vi
        .mocked(commandUtils.execCommand)
        .mock.calls.find(
          (c) => c[1].includes('update-function-configuration') && c[1].includes('--environment')
        );
      expect(update).toBeUndefined();
    });

    it('performs coordinated S3 migration when old-format buckets exist', () => {
      // Mock s3 ls to return status 0 (buckets exist)
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        const has = (s) => args.some((a) => String(a).includes(s));
        if (cmd === 'aws' && has('s3') && has('ls')) {
          return { status: 0, stdout: 'bucket exists\n', stderr: '' };
        }
        return defaultExec(cmd, args);
      });

      deployServerless({ stackName: 'wishboard-serverless-dev', region: 'us-east-1', mode: 'dev' });

      // Verify that the images sync was called from oldImagesBucket to new imagesBucket
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining([
          's3',
          'sync',
          's3://wishboard-dev-images-123456789012',
          's3://images-bucket',
        ]),
        expect.any(Object)
      );

      // Verify that old buckets were emptied (rm)
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining([
          's3',
          'rm',
          's3://wishboard-dev-images-123456789012',
          '--recursive',
        ]),
        expect.any(Object)
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining([
          's3',
          'rm',
          's3://wishboard-dev-frontend-123456789012',
          '--recursive',
        ]),
        expect.any(Object)
      );

      // Verify that old buckets were deleted (rb)
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['s3', 'rb', 's3://wishboard-dev-images-123456789012']),
        expect.any(Object)
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['s3', 'rb', 's3://wishboard-dev-frontend-123456789012']),
        expect.any(Object)
      );
    });
  });

  describe('destroyServerless', () => {
    it('refuses to delete a production stack without --force', () => {
      expect(() => destroyServerless({ stackName: 'wishboard-serverless' })).toThrow(
        'Refusing to delete production stack without --force'
      );
    });

    it('deletes a dev stack: empties buckets then runs sam delete', () => {
      destroyServerless({ stackName: 'wishboard-serverless-dev', region: 'us-east-1' });

      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['s3', 'rm', 's3://frontend-bucket', '--recursive']),
        expect.any(Object)
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'sam',
        expect.arrayContaining([
          'delete',
          '--stack-name',
          'wishboard-serverless-dev',
          '--no-prompts',
        ]),
        expect.any(Object)
      );
    });

    it('allows deleting a production stack with --force', () => {
      destroyServerless({ stackName: 'wishboard-prod', force: true });
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'sam',
        expect.arrayContaining(['delete', '--stack-name', 'wishboard-prod']),
        expect.any(Object)
      );
    });

    it('returns early when the stack does not exist', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws' && args.includes('StackStatus')) {
          return { status: 0, stdout: 'None\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      destroyServerless({ stackName: 'wishboard-serverless-dev' });
      expect(vi.mocked(commandUtils.execCommand).mock.calls.some((c) => c[0] === 'sam')).toBe(
        false
      );
    });

    it('throws if sam delete fails', () => {
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args = []) => {
        if (cmd === 'sam' && args.includes('delete')) return { status: 1, stdout: '', stderr: 'x' };
        return defaultExec(cmd, args);
      });
      expect(() => destroyServerless({ stackName: 'wishboard-serverless-dev' })).toThrow(
        'sam delete failed.'
      );
    });

    it('empties both the frontend and images buckets before deleting', () => {
      destroyServerless({ stackName: 'wishboard-serverless-dev' });
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['s3', 'rm', 's3://frontend-bucket', '--recursive']),
        expect.any(Object)
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        expect.arrayContaining(['s3', 'rm', 's3://images-bucket', '--recursive']),
        expect.any(Object)
      );
    });

    it('passes dryRun through and does not empty buckets on a dry run', () => {
      destroyServerless({ stackName: 'wishboard-serverless-dev', dryRun: true });
      const calls = vi.mocked(commandUtils.execCommand).mock.calls;
      // No real bucket emptying (getStackOutput returns dry-run- placeholders).
      expect(calls.some((c) => c[1].includes('rm'))).toBe(false);
      const del = calls.find((c) => c[0] === 'sam' && c[1].includes('delete'));
      expect(del).toBeDefined();
      expect(del[2]).toEqual(expect.objectContaining({ dryRun: true }));
    });
  });
});

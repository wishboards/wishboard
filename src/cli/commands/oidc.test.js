import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupOidc, destroyOidc, checkGitHubAuth, setGitHubRepoValue } from './oidc.js';
import * as commandUtils from '../commandUtils.js';

vi.mock('../commandUtils.js', () => ({
  hasCommand: vi.fn(),
  getGitRepoInfo: vi.fn(),
  execCommand: vi.fn(),
}));

describe('oidc commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('setupOidc', () => {
    it('throws error if AWS CLI is missing', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd !== 'aws');

      expect(() => setupOidc({ org: 'test-org', repo: 'test-repo', region: 'us-west-2' })).toThrow(
        'AWS CLI missing'
      );
    });

    it('throws error if AWS authentication fails', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws' && args.includes('get-caller-identity')) {
          return { status: 1, stdout: '', stderr: 'Auth error' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      expect(() => setupOidc({ org: 'test-org', repo: 'test-repo' })).toThrow(
        'AWS authentication failed'
      );
    });

    it('performs full setup with git remote auto-detection and GitHub CLI configured', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true); // aws and gh exist
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue({
        org: 'detected-org',
        repo: 'detected-repo',
      });
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws') {
          if (args.includes('get-caller-identity')) {
            return { status: 0, stdout: '123456789012\n', stderr: '' };
          }
          if (args.includes('describe-stack-resource')) {
            return { status: 0, stdout: 'None\n', stderr: '' };
          }
          if (args.includes('list-open-id-connect-providers')) {
            return {
              status: 0,
              stdout:
                'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n',
              stderr: '',
            };
          }
          if (args.includes('describe-stacks')) {
            return {
              status: 0,
              stdout: 'arn:aws:iam::123456789012:role/detected-repo-github-oidc-role\n',
              stderr: '',
            };
          }
        }
        if (cmd === 'gh' && args.includes('status')) {
          return { status: 0, stdout: 'Logged in', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      setupOidc({ region: 'us-west-2' });

      // Verifies it detected repository from git remote
      expect(commandUtils.getGitRepoInfo).toHaveBeenCalled();

      // Verifies CloudFormation deploy command was executed with the external OIDC Provider ARN
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        [
          'cloudformation',
          'deploy',
          '--template-file',
          'aws-serverless/github-oidc-role.yaml',
          '--stack-name',
          'detected-repo-github-oidc-setup',
          '--parameter-overrides',
          'GitHubOrg=detected-org',
          'GitHubRepo=detected-repo',
          'OidcProviderArn=arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
          '--capabilities',
          'CAPABILITY_NAMED_IAM',
          '--region',
          'us-west-2',
        ],
        { dryRun: false }
      );

      // Verifies GitHub secrets and repo-wide variables were registered (no unprefixed AWS_STACK_NAME)
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        [
          'secret',
          'set',
          'AWS_ROLE_TO_ASSUME',
          '--body',
          'arn:aws:iam::123456789012:role/detected-repo-github-oidc-role',
        ],
        { dryRun: false }
      );
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['variable', 'set', 'AWS_REGION', '--body', 'us-west-2'],
        { dryRun: false }
      );
      expect(commandUtils.execCommand).not.toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['AWS_STACK_NAME']),
        expect.anything()
      );
    });

    it('falls back to printing manual instructions when GitHub CLI is missing', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd !== 'gh');
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue(null);
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws') {
          if (args.includes('get-caller-identity')) {
            return { status: 0, stdout: '123456789012\n', stderr: '' };
          }
          if (args.includes('describe-stack-resource')) {
            return {
              status: 0,
              stdout:
                'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n',
              stderr: '',
            };
          }
          if (args.includes('describe-stacks')) {
            return {
              status: 0,
              stdout: 'arn:aws:iam::123456789012:role/manual-role\n',
              stderr: '',
            };
          }
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      const consoleSpy = vi.spyOn(console, 'log');

      setupOidc({ org: 'manual-org', repo: 'manual-repo', region: 'us-east-1' });

      // Should check if StackResourceDetail GithubOidcProvider is managed by stack
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        [
          'cloudformation',
          'describe-stack-resource',
          '--stack-name',
          'manual-repo-github-oidc-setup',
          '--logical-resource-id',
          'GithubOidcProvider',
          '--query',
          'StackResourceDetail.PhysicalResourceId',
          '--output',
          'text',
        ],
        { stdio: 'pipe' }
      );

      // Should check for gh presence
      expect(commandUtils.hasCommand).toHaveBeenCalledWith('gh');

      // Verify it logs manual setup details
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Please manually set the following in your GitHub Repository settings'
        )
      );
    });

    it('throws error when auto-detection fails and no org/repo are provided', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue(null);

      expect(() => setupOidc({ region: 'us-west-2' })).toThrow(
        'Could not detect GitHub repository from Git remote or package.json repository field'
      );
    });

    it('throws error if cloudformation deploy command fails', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue({ org: 'o', repo: 'r' });
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws') {
          if (args.includes('get-caller-identity')) {
            return { status: 0, stdout: '123456789012\n', stderr: '' };
          }
          if (args.includes('list-open-id-connect-providers')) {
            return {
              status: 0,
              stdout:
                'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n',
              stderr: '',
            };
          }
          if (args.includes('deploy')) {
            return { status: 1, stdout: '', stderr: 'CloudFormation deploy failed' };
          }
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      expect(() => setupOidc({ region: 'us-west-2' })).toThrow('CloudFormation deploy failed');
    });

    it('throws error if retrieving deployment role ARN fails', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue({ org: 'o', repo: 'r' });
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws') {
          if (args.includes('get-caller-identity')) {
            return { status: 0, stdout: '123456789012\n', stderr: '' };
          }
          if (args.includes('list-open-id-connect-providers')) {
            return {
              status: 0,
              stdout:
                'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n',
              stderr: '',
            };
          }
          if (args.includes('describe-stacks')) {
            return { status: 1, stdout: '', stderr: 'Describe stacks failed' };
          }
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      expect(() => setupOidc({ region: 'us-west-2' })).toThrow('Failed to retrieve RoleArn');
    });

    it('falls back to manual instructions if registering secrets via gh CLI fails', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue({ org: 'o', repo: 'r' });
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'aws') {
          if (args.includes('get-caller-identity')) {
            return { status: 0, stdout: '123456789012\n', stderr: '' };
          }
          if (args.includes('list-open-id-connect-providers')) {
            return {
              status: 0,
              stdout:
                'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n',
              stderr: '',
            };
          }
          if (args.includes('describe-stacks')) {
            return { status: 0, stdout: 'arn:aws:iam::123456789012:role/role-name\n', stderr: '' };
          }
        }
        if (cmd === 'gh') {
          if (args.includes('status')) {
            return { status: 0, stdout: 'Logged in', stderr: '' };
          }
          if (args.includes('secret') || args.includes('variable')) {
            return { status: 1, stdout: '', stderr: 'API Error' };
          }
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      const consoleSpy = vi.spyOn(console, 'log');
      setupOidc({ region: 'us-west-2' });

      // Verifies that it fell back to logging manual setup instructions
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Please manually set the following in your GitHub Repository settings'
        )
      );
    });
  });

  describe('destroyOidc', () => {
    it('deletes the cloudformation stack and deletes GitHub CLI secrets if gh is authenticated', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue(null);
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args.includes('status')) {
          return { status: 0, stdout: 'Logged in', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      destroyOidc({ org: 'myorg', repo: 'myrepo', region: 'eu-west-1' });

      // Check aws stack delete call
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        [
          'cloudformation',
          'delete-stack',
          '--stack-name',
          'myrepo-github-oidc-setup',
          '--region',
          'eu-west-1',
        ],
        { dryRun: false }
      );

      expect(commandUtils.execCommand).toHaveBeenCalledWith('aws', [
        'cloudformation',
        'wait',
        'stack-delete-complete',
        '--stack-name',
        'myrepo-github-oidc-setup',
        '--region',
        'eu-west-1',
      ]);

      // Check gh secret/variable deletions
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['secret', 'delete', 'AWS_ROLE_TO_ASSUME'],
        { dryRun: false, stdio: 'ignore' }
      );

      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['variable', 'delete', 'AWS_REGION'],
        { dryRun: false, stdio: 'ignore' }
      );
    });

    it('skips deleting github secrets if gh CLI is missing or not authenticated', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd !== 'gh');
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: '', stderr: '' });

      destroyOidc({ org: 'myorg', repo: 'myrepo' });

      // Should still delete CF stack
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'aws',
        [
          'cloudformation',
          'delete-stack',
          '--stack-name',
          'myrepo-github-oidc-setup',
          '--region',
          'us-east-1',
        ],
        { dryRun: false }
      );

      // Should not call gh secret delete
      expect(commandUtils.execCommand).not.toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['secret', 'delete']),
        expect.any(Object)
      );
    });

    it('skips deleting github secrets if gh status shows not logged in', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args.includes('status')) {
          return { status: 1, stdout: '', stderr: 'Not logged in' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });

      destroyOidc({ org: 'myorg', repo: 'myrepo' });

      // Should not call gh secret delete
      expect(commandUtils.execCommand).not.toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['secret', 'delete']),
        expect.any(Object)
      );
    });
  });

  describe('checkGitHubAuth', () => {
    it('returns true on dryRun without invoking gh', () => {
      expect(checkGitHubAuth(true)).toBe(true);
      expect(commandUtils.execCommand).not.toHaveBeenCalled();
    });

    it('returns true when gh status exits 0', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: 'ok', stderr: '' });
      expect(checkGitHubAuth(false)).toBe(true);
      expect(commandUtils.execCommand).toHaveBeenCalledWith('gh', ['auth', 'status'], {
        stdio: 'pipe',
      });
    });

    it('returns false when gh status fails', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error',
      });
      expect(checkGitHubAuth(false)).toBe(false);
    });
  });

  describe('setGitHubRepoValue', () => {
    it('sets secret without app flag', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      const ok = setGitHubRepoValue('secret', 'MY_SECRET', 'val123', false);
      expect(ok).toBe(true);
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['secret', 'set', 'MY_SECRET', '--body', 'val123'],
        { dryRun: false }
      );
    });

    it('sets secret with --app flag', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      const ok = setGitHubRepoValue('secret', 'MY_SECRET', 'val123', false, 'dependabot');
      expect(ok).toBe(true);
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['secret', 'set', 'MY_SECRET', '--body', 'val123', '--app', 'dependabot'],
        { dryRun: false }
      );
    });

    it('returns false and logs warning if gh command fails', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'failed',
      });
      const ok = setGitHubRepoValue('variable', 'MY_VAR', 'val123', false);
      expect(ok).toBe(false);
    });
  });

  describe('exact AWS/gh invocation sequences', () => {
    const okRes = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    const logLines = () => vi.mocked(console.log).mock.calls.map((c) => c[0]);
    const warnLines = () => vi.mocked(console.warn).mock.calls.map((c) => c[0]);
    const errorLines = () => vi.mocked(console.error).mock.calls.map((c) => c[0]);

    function setupExec(routes) {
      const calls = [];
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        for (const [match, res] of routes) {
          if (match(cmd, args)) return res;
        }
        return okRes();
      });
      return calls;
    }

    const baseRoutes = (overrides = {}) => {
      const table = {
        sts: okRes('123456789012\n'),
        stackResource: okRes('None\n'),
        listProviders: okRes(
          'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n'
        ),
        deploy: okRes(),
        describeStacks: okRes('arn:aws:iam::123456789012:role/test-repo-github-oidc-setup-Role\n'),
        ghAuth: okRes(),
        ghSet: okRes(),
        ...overrides,
      };
      return [
        [(c, a) => c === 'aws' && a.includes('get-caller-identity'), table.sts],
        [(c, a) => c === 'aws' && a.includes('describe-stack-resource'), table.stackResource],
        [
          (c, a) => c === 'aws' && a.includes('list-open-id-connect-providers'),
          table.listProviders,
        ],
        [(c, a) => c === 'aws' && a.includes('deploy'), table.deploy],
        [(c, a) => c === 'aws' && a.includes('describe-stacks'), table.describeStacks],
        [(c, a) => c === 'gh' && a.includes('auth'), table.ghAuth],
        [(c) => c === 'gh', table.ghSet],
      ];
    };

    it('full setup: every aws and gh call matches exactly, in order', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = setupExec(baseRoutes());
      setupOidc({ org: 'test-org', repo: 'test-repo', region: 'us-west-2' });
      expect(calls).toEqual([
        [
          'aws',
          ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
          { stdio: 'pipe' },
        ],
        [
          'aws',
          [
            'cloudformation',
            'describe-stack-resource',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--logical-resource-id',
            'GithubOidcProvider',
            '--query',
            'StackResourceDetail.PhysicalResourceId',
            '--output',
            'text',
          ],
          { stdio: 'pipe' },
        ],
        [
          'aws',
          [
            'iam',
            'list-open-id-connect-providers',
            '--query',
            "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]",
            '--output',
            'text',
          ],
          { stdio: 'pipe' },
        ],
        [
          'aws',
          [
            'cloudformation',
            'deploy',
            '--template-file',
            'aws-serverless/github-oidc-role.yaml',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--parameter-overrides',
            'GitHubOrg=test-org',
            'GitHubRepo=test-repo',
            'OidcProviderArn=arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
            '--capabilities',
            'CAPABILITY_NAMED_IAM',
            '--region',
            'us-west-2',
          ],
          { dryRun: false },
        ],
        [
          'aws',
          [
            'cloudformation',
            'describe-stacks',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--query',
            "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue",
            '--output',
            'text',
            '--region',
            'us-west-2',
          ],
          { stdio: 'pipe' },
        ],
        ['gh', ['auth', 'status'], { stdio: 'pipe' }],
        [
          'gh',
          [
            'secret',
            'set',
            'AWS_ROLE_TO_ASSUME',
            '--body',
            'arn:aws:iam::123456789012:role/test-repo-github-oidc-setup-Role',
          ],
          { dryRun: false },
        ],
        ['gh', ['variable', 'set', 'AWS_REGION', '--body', 'us-west-2'], { dryRun: false }],
      ]);
      const lines = logLines();
      expect(lines).toContain('    Authenticated to AWS Account: 123456789012');
      expect(lines).toContain('    Target Deployment Region: us-west-2');
      expect(lines).toContain(
        '    Found existing external GitHub OIDC provider: arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com'
      );
      expect(lines).toContain(
        '\x1b[32mRole ARN: arn:aws:iam::123456789012:role/test-repo-github-oidc-setup-Role\x1b[0m\n'
      );
      expect(lines).toContain('\x1b[32mOIDC Setup Complete!\x1b[0m');
    });

    it('stack-managed provider: skips the IAM list call and deploys with an empty provider ARN', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = setupExec(
        baseRoutes({
          stackResource: okRes(
            'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com\n'
          ),
        })
      );
      setupOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(calls.some(([, a]) => a.includes('list-open-id-connect-providers'))).toBe(false);
      const deploy = calls.find(([, a]) => a.includes('deploy'));
      expect(deploy[1]).toContain('OidcProviderArn=');
      expect(logLines()).toContain(
        '    GitHub OIDC provider is managed by this stack. Keeping it.'
      );
    });

    it('no provider anywhere: deploys with an empty ARN and logs the creation note', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = setupExec(baseRoutes({ listProviders: okRes('None\n') }));
      setupOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      const deploy = calls.find(([, a]) => a.includes('deploy'));
      expect(deploy[1]).toContain('OidcProviderArn=');
      expect(logLines()).toContain(
        '    No existing GitHub OIDC provider found. It will be created.'
      );
    });

    it('stack lookup failure or empty output still consults the IAM list', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      for (const stackResource of [
        { status: 1, stdout: '', stderr: 'no stack' },
        okRes(''),
        okRes('None\n'),
      ]) {
        vi.clearAllMocks();
        vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
        const calls = setupExec(baseRoutes({ stackResource }));
        setupOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
        expect(calls.some(([, a]) => a.includes('list-open-id-connect-providers'))).toBe(true);
        const deploy = calls.find(([, a]) => a.includes('deploy'));
        expect(deploy[1]).toContain(
          'OidcProviderArn=arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com'
        );
      }
    });

    it('role ARN retrieval failures throw the exact error and log the exact line', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      for (const describeStacks of [
        { status: 1, stdout: '', stderr: 'gone' },
        okRes('None\n'),
        okRes(''),
      ]) {
        vi.clearAllMocks();
        vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
        setupExec(baseRoutes({ describeStacks }));
        expect(() => setupOidc({ org: 'o', repo: 'test-repo' })).toThrowError(
          new Error('Failed to retrieve RoleArn')
        );
        expect(errorLines()).toContain(
          'ERROR: Failed to retrieve RoleArn output from CloudFormation stack.'
        );
      }
    });

    it('deploy failure throws the exact error', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      setupExec(baseRoutes({ deploy: { status: 1, stdout: '', stderr: 'bad template' } }));
      expect(() => setupOidc({ org: 'o', repo: 'test-repo' })).toThrowError(
        new Error('CloudFormation deploy failed')
      );
      expect(errorLines()).toContain('ERROR: CloudFormation deployment failed.');
    });

    it('gh missing prints the full manual instructions verbatim', () => {
      vi.mocked(commandUtils.hasCommand).mockImplementation((cmd) => cmd === 'aws');
      setupExec(baseRoutes());
      setupOidc({ org: 'o', repo: 'test-repo', region: 'eu-west-1' });
      const lines = logLines();
      expect(lines).toContain('    GitHub CLI (gh) not detected.');
      expect(lines).toContain(
        '\x1b[33mPlease manually set the following in your GitHub Repository settings (Settings -> Secrets and variables -> Actions):\x1b[0m\n'
      );
      expect(lines).toContain('  \x1b[32mRepository Secrets:\x1b[0m');
      expect(lines).toContain('    Name:  \x1b[36mAWS_ROLE_TO_ASSUME\x1b[0m');
      expect(lines).toContain(
        '    Value: arn:aws:iam::123456789012:role/test-repo-github-oidc-setup-Role\n'
      );
      expect(lines).toContain('  \x1b[32mRepository Variables:\x1b[0m');
      expect(lines).toContain('    Name:  \x1b[36mAWS_REGION\x1b[0m');
      expect(lines).toContain('    Value: eu-west-1\n');
    });

    it('gh present but unauthenticated warns exactly and prints manual instructions', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      setupExec(baseRoutes({ ghAuth: { status: 1, stdout: '', stderr: '' } }));
      setupOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(warnLines()).toContain(
        "WARNING: GitHub CLI (gh) is installed but not authenticated. Run 'gh auth login' to authenticate."
      );
      expect(logLines().some((l) => l.includes('Please manually set the following'))).toBe(true);
    });

    it('a failed variable set after a successful secret set prints manual instructions', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = [];
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        if (cmd === 'gh' && args[0] === 'variable') return { status: 1, stdout: '', stderr: '' };
        if (cmd === 'aws' && args.includes('get-caller-identity')) return okRes('123456789012\n');
        if (cmd === 'aws' && args.includes('describe-stack-resource')) return okRes('None\n');
        if (cmd === 'aws' && args.includes('list-open-id-connect-providers'))
          return okRes('None\n');
        if (cmd === 'aws' && args.includes('describe-stacks'))
          return okRes('arn:aws:iam::123456789012:role/r\n');
        return okRes();
      });
      setupOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(logLines().some((l) => l.includes('Please manually set the following'))).toBe(true);
    });

    it('resolveParams fills only the missing half and logs the detected repo', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue({
        org: 'git-org',
        repo: 'git-repo',
      });
      setupExec(baseRoutes());
      setupOidc({ org: 'my-org', dryRun: true });
      expect(logLines()).toContain('    Detected GitHub repository: my-org/git-repo');
    });

    it('resolveParams throws the exact message when detection fails', () => {
      vi.mocked(commandUtils.getGitRepoInfo).mockReturnValue(null);
      expect(() => setupOidc({})).toThrowError(
        new Error(
          'Could not detect GitHub repository from Git remote or package.json repository field. Please provide --org and --repo.'
        )
      );
    });
  });

  describe('checkGitHubAuth and setGitHubRepoValue exact behavior', () => {
    const warnLines = () => vi.mocked(console.warn).mock.calls.map((c) => c[0]);
    const logLines = () => vi.mocked(console.log).mock.calls.map((c) => c[0]);

    it('checkGitHubAuth maps the gh exit status and skips the call in dry run', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      expect(checkGitHubAuth(false)).toBe(true);
      expect(commandUtils.execCommand).toHaveBeenCalledWith('gh', ['auth', 'status'], {
        stdio: 'pipe',
      });
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 2, stdout: '', stderr: '' });
      expect(checkGitHubAuth(false)).toBe(false);
      vi.clearAllMocks();
      expect(checkGitHubAuth(true)).toBe(true);
      expect(commandUtils.execCommand).not.toHaveBeenCalled();
    });

    it('setGitHubRepoValue with an app: exact args, success log, and failure warning', () => {
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 0, stdout: '', stderr: '' });
      expect(setGitHubRepoValue('secret', 'FOO', 'bar', false, 'dependabot')).toBe(true);
      expect(commandUtils.execCommand).toHaveBeenCalledWith(
        'gh',
        ['secret', 'set', 'FOO', '--body', 'bar', '--app', 'dependabot'],
        { dryRun: false }
      );
      expect(logLines()).toContain('    Set secret: FOO (app: dependabot)');
      vi.mocked(commandUtils.execCommand).mockReturnValue({ status: 1, stdout: '', stderr: '' });
      expect(setGitHubRepoValue('secret', 'FOO', 'bar', false, 'dependabot')).toBe(false);
      expect(warnLines()).toContain(
        'WARNING: Failed to set secret FOO (app: dependabot) via GitHub CLI.'
      );
    });
  });

  describe('destroyOidc exact sequences', () => {
    const okRes = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    const logLines = () => vi.mocked(console.log).mock.calls.map((c) => c[0]);
    const warnLines = () => vi.mocked(console.warn).mock.calls.map((c) => c[0]);

    function destroyCalls() {
      const calls = [];
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        return okRes();
      });
      return calls;
    }

    it('dry run: deletes the stack, skips the wait, and cleans gh values with dryRun opts', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = destroyCalls();
      destroyOidc({ org: 'o', repo: 'test-repo', region: 'eu-west-1', dryRun: true });
      expect(calls).toEqual([
        [
          'aws',
          [
            'cloudformation',
            'delete-stack',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--region',
            'eu-west-1',
          ],
          { dryRun: true },
        ],
        ['gh', ['secret', 'delete', 'AWS_ROLE_TO_ASSUME'], { dryRun: true, stdio: 'ignore' }],
        ['gh', ['variable', 'delete', 'AWS_REGION'], { dryRun: true, stdio: 'ignore' }],
      ]);
      expect(logLines()).toContain('\x1b[32mOIDC Teardown Complete!\x1b[0m');
    });

    it('real run: waits for stack deletion, checks gh auth, then deletes both values', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = destroyCalls();
      destroyOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(calls).toEqual([
        [
          'aws',
          [
            'cloudformation',
            'delete-stack',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--region',
            'us-east-1',
          ],
          { dryRun: false },
        ],
        [
          'aws',
          [
            'cloudformation',
            'wait',
            'stack-delete-complete',
            '--stack-name',
            'test-repo-github-oidc-setup',
            '--region',
            'us-east-1',
          ],
          undefined,
        ],
        ['gh', ['auth', 'status'], { stdio: 'pipe' }],
        ['gh', ['secret', 'delete', 'AWS_ROLE_TO_ASSUME'], { dryRun: false, stdio: 'ignore' }],
        ['gh', ['variable', 'delete', 'AWS_REGION'], { dryRun: false, stdio: 'ignore' }],
      ]);
      const lines = logLines();
      expect(lines).toContain('    Deleted secret: AWS_ROLE_TO_ASSUME');
      expect(lines).toContain('    Deleted variable: AWS_REGION');
    });

    it('gh unauthenticated: warns exactly and deletes nothing', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(true);
      const calls = [];
      vi.mocked(commandUtils.execCommand).mockImplementation((cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        if (cmd === 'gh') return { status: 1, stdout: '', stderr: '' };
        return okRes();
      });
      destroyOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(warnLines()).toContain(
        'WARNING: GitHub CLI (gh) is installed but not authenticated. Skipping secrets cleanup.'
      );
      expect(calls.some(([c, a]) => c === 'gh' && a.includes('delete'))).toBe(false);
    });

    it('gh missing: logs the manual-removal line', () => {
      vi.mocked(commandUtils.hasCommand).mockReturnValue(false);
      destroyCalls();
      destroyOidc({ org: 'o', repo: 'test-repo', region: 'us-east-1' });
      expect(logLines()).toContain(
        '    GitHub CLI (gh) not detected. Please manually remove secrets/variables from repository settings.'
      );
    });
  });
});

/** @vitest-environment node */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasCommand, execCommand } from '../../src/cli/commandUtils.js';

// Exercises the real `sam` CLI against the deployment template — a regression
// class the mocked unit suite can't reach (it never touches template.yaml, and
// it stubs execCommand). Routing through commandUtils also verifies the real
// Windows .cmd-spawn path that unit tests mock. Skipped where sam isn't
// installed; CI runners include the SAM CLI.
const samAvailable = hasCommand('sam');
const template = path.resolve(process.cwd(), 'aws-serverless/template.yaml');

describe('integration: SAM template contract', () => {
  it.skipIf(!samAvailable)(
    'validates aws-serverless/template.yaml with the real sam CLI',
    () => {
      const res = execCommand(
        'sam',
        ['validate', '--template', template, '--region', 'us-east-1'],
        {
          stdio: 'pipe',
        }
      );
      expect(res.status).toBe(0);
    },
    60000
  );

  it('declares HttpApi events and CloudFront behaviors for /api-docs and /openapi.json', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(template, 'utf8');

    // HttpApi event routes on ApiFunction
    expect(content).toContain('Path: /api-docs');
    expect(content).toContain('Path: /api-docs/{proxy+}');
    expect(content).toContain('Path: /openapi.json');

    // CloudFront cache behaviors routing to BackendApiOrigin
    expect(content).toContain('PathPattern: /api-docs*');
    expect(content).toContain('PathPattern: /openapi.json');
  });
});

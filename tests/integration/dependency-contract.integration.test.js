/** @vitest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Build-contract invariants that a clean CI runner enforces but a local dev
// machine can mask. Both bugs below shipped because the mocked unit suite and a
// warm local environment couldn't see them.
const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};

describe('integration: production image ships what the bundled CLI needs', () => {
  // `docker exec wishboard node src/cli/wishboard.js db ...` (backup, restore,
  // reset-password) crashed with ENOENT because the runner stage never copied
  // package.json, which wishboard.js reads at startup for its version.
  it('copies package.json into the runner image alongside src/cli', () => {
    const dockerfile = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const runnerStage = dockerfile.slice(dockerfile.lastIndexOf('AS runner'));
    expect(runnerStage).toMatch(/COPY --from=builder \/app\/src\/cli \.\/src\/cli/);
    expect(runnerStage).toMatch(/^COPY package\.json \.\/package\.json$/m);
    const cliSource = fs.readFileSync(path.resolve(process.cwd(), 'src/cli/wishboard.js'), 'utf8');
    expect(cliSource).toContain("'../../package.json'");
  });
});

describe('integration: package.json dependency-placement contract', () => {
  // `sam build` runs a production-only `npm install` and then requires esbuild,
  // so it MUST be a runtime dependency — a clean runner failed with "Cannot find
  // esbuild" when it was a devDependency. See the note in aws-serverless/template.yaml.
  it('keeps esbuild in dependencies (required by the SAM esbuild builder on clean hosts)', () => {
    expect(deps).toHaveProperty('esbuild');
    expect(devDeps).not.toHaveProperty('esbuild');
  });

  // Client-only libraries are bundled into dist/ by Vite and must NOT ship in the
  // production image (its deps stage runs `npm ci --omit=dev`). Keep them dev-only
  // so the runtime image stays slim.
  it.each([
    'react',
    'react-dom',
    'recharts',
    'qrcode.react',
    'socket.io-client',
    '@techstark/opencv-js',
    'tesseract.js',
  ])('keeps client-only package %s out of runtime dependencies', (name) => {
    expect(deps).not.toHaveProperty(name);
    expect(devDeps).toHaveProperty(name);
  });
});

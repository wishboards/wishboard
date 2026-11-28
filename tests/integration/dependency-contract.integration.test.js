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

  it('prepares profile sticker assets before running Vite build in Dockerfile and serverless deploy', () => {
    const dockerfile = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/wishboard\.js\s+build\s+prepare-profile\s+&&\s+npm\s+run\s+build/);
    const serverlessCli = fs.readFileSync(
      path.resolve(process.cwd(), 'src/cli/commands/serverless.js'),
      'utf8'
    );
    expect(serverlessCli).toMatch(/['"]build['"],\s*['"]prepare-profile['"]/);
  });

  // Browsers refuse to render standalone .svg files loaded via <img src="...">
  // unless the root <svg> element declares xmlns="http://www.w3.org/2000/svg".
  it('ensures every profile SVG asset declares the SVG XML namespace', () => {
    const profilesDir = path.resolve(process.cwd(), 'profiles');
    const missingXmlns = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.svg')) {
          const raw = fs.readFileSync(full, 'utf8');
          if (!/<svg\b[^>]*\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(raw)) {
            missingXmlns.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
          }
        }
      }
    };
    walk(profilesDir);
    expect(missingXmlns).toEqual([]);
  });

  // Every static and dynamic relative import in src/server and src/cli must resolve
  // to a path covered by a COPY directive in the Dockerfile `runner` stage.
  it('covers every relative runtime import in src/server and src/cli in the Dockerfile runner stage', () => {
    const repoRoot = process.cwd();
    const dockerfile = fs.readFileSync(path.resolve(repoRoot, 'Dockerfile'), 'utf8');
    const runnerStage = dockerfile.slice(dockerfile.lastIndexOf('AS runner'));

    const copiedPaths = [];
    for (const line of runnerStage.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('COPY ')) continue;
      const tokens = trimmed
        .replace(/^COPY\s+(?:--from=\S+\s+)?/, '')
        .split(/\s+/)
        .filter(Boolean);
      if (tokens.length >= 2) {
        const dest = tokens.at(-1).replace(/^\.\//, '').replace(/\/+$/, '');
        copiedPaths.push(dest);
      }
    }

    const collectJsFiles = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...collectJsFiles(full));
        } else if (/\.(?:js|mjs)$/.test(entry.name) && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };

    const isCoveredByRunnerCopy = (relPath) =>
      copiedPaths.some((dest) => relPath === dest || relPath.startsWith(`${dest}/`));

    const importPattern = /(?:from\s+|import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?)['"](\.[^'"]+)['"]/g;

    const missing = [];
    for (const rootDir of ['src/server', 'src/cli']) {
      for (const file of collectJsFiles(path.resolve(repoRoot, rootDir))) {
        const raw = fs.readFileSync(file, 'utf8');
        for (const match of raw.matchAll(importPattern)) {
          const spec = match[1];
          const resolved = path.resolve(path.dirname(file), spec);
          const rel = path.relative(repoRoot, resolved).replace(/\\/g, '/');
          if (!isCoveredByRunnerCopy(rel)) {
            missing.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')} -> ${rel}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
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

describe('integration: Starlight documentation frontmatter & single-H1 contract', () => {
  const docsRoot = path.resolve(process.cwd(), 'docs/src/content/docs');

  function collectMarkdownFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectMarkdownFiles(fullPath));
      } else if (/\.mdx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  // Astro Starlight automatically renders the frontmatter `title` field as the
  // page's primary `<h1 id="_top">` element. Any additional `# Heading` in the
  // Markdown body emits a duplicate stacked `<h1>` on the published docs site.
  it('ensures every docs page defines a frontmatter title and has no duplicate body H1 headings', () => {
    const mdFiles = collectMarkdownFiles(docsRoot);
    expect(mdFiles.length).toBeGreaterThan(0);

    const missingTitle = [];
    const duplicateBodyH1 = [];

    for (const file of mdFiles) {
      const rel = path.relative(docsRoot, file).replace(/\\/g, '/');
      const raw = fs.readFileSync(file, 'utf8');
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
      if (!fmMatch || !/^title:\s*\S+/m.test(fmMatch[1])) {
        missingTitle.push(rel);
        continue;
      }

      const bodyLines = raw.slice(fmMatch[0].length).split(/\r?\n/);
      let inCodeFence = false;
      bodyLines.forEach((line, idx) => {
        if (/^```/.test(line.trim())) {
          inCodeFence = !inCodeFence;
          return;
        }
        if (!inCodeFence && /^#\s+\S/.test(line)) {
          duplicateBodyH1.push(`${rel}:${idx + 1}: ${line}`);
        }
      });
    }

    expect(missingTitle).toEqual([]);
    expect(duplicateBodyH1).toEqual([]);
  });
});

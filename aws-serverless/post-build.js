// Post-build step for the AWS SAM esbuild build.
//
// esbuild bundles the JS layer of @libsql/client just fine, but the native
// binding (@libsql/linux-x64-gnu/index.node) cannot be bundled. The bundle
// therefore performs a runtime `require("@libsql/linux-x64-gnu")`, and that
// package is marked `External` in template.yaml. SAM's esbuild build method
// does NOT copy external packages into the artifact, so without this script the
// Lambda throws "Cannot find module '@libsql/linux-x64-gnu'" at module load and
// every API call returns HTTP 500.
//
// Run this AFTER `sam build` and BEFORE `sam deploy`:
//   sam build && node aws-serverless/post-build.js && sam deploy

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_EVENT_PROFILE } from '../src/cli/commandUtils.js';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getOpenApiDocument } from '../src/server/docs/openapi.js';
import { renderApiReference } from '@scalar/client-side-rendering';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export function generateStaticApiDocs(distDir = path.join(repoRoot, 'dist')) {
  if (!fs.existsSync(distDir)) {
    console.log(
      `Frontend dist directory not found at ${distDir}; skipping static API docs generation.`
    );
    return;
  }

  const spec = getOpenApiDocument();
  fs.writeFileSync(path.join(distDir, 'openapi.json'), JSON.stringify(spec, null, 2), 'utf8');

  const html = renderApiReference({
    config: {
      spec: {
        content: spec,
      },
    },
    pageTitle: 'Wishboard API Reference',
    theme: 'purple',
  });

  const apiDocsDir = path.join(distDir, 'api-docs');
  fs.mkdirSync(apiDocsDir, { recursive: true });
  fs.writeFileSync(path.join(apiDocsDir, 'index.html'), html, 'utf8');

  const apiDocsSubdir = path.join(distDir, 'api', 'docs');
  fs.mkdirSync(apiDocsSubdir, { recursive: true });
  fs.writeFileSync(path.join(apiDocsSubdir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(distDir, 'api-docs.html'), html, 'utf8');
  console.log(`Generated static API docs and openapi.json in ${path.relative(repoRoot, distDir)}`);
}

// Lambda runtime (nodejs24.x) runs on Amazon Linux 2023 (glibc, x64), so the
// linux-x64-gnu binary is the correct one to ship.
const NATIVE_PKG = '@libsql/linux-x64-gnu';

const srcPkgDir = path.join(repoRoot, 'node_modules', NATIVE_PKG);
const buildDir = path.join(__dirname, '.aws-sam', 'build');

// Both functions import src/server/db.js, so both need the native binding.
const functions = ['ApiFunction', 'WebSocketFunction'];

export function copyProfileConfigs(profileName, fnDir, repoRoot) {
  const profileDir = path.join(repoRoot, 'profiles', profileName);
  if (!fs.existsSync(profileDir)) {
    throw new Error(`Event profile '${profileName}' not found at ${profileDir}`);
  }

  const yamlFiles = fs
    .readdirSync(profileDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  if (!yamlFiles.includes('profile.yaml')) {
    throw new Error(`Event profile '${profileName}' missing profile.yaml at ${profileDir}`);
  }

  for (const yamlFile of yamlFiles) {
    const srcFile = path.join(profileDir, yamlFile);
    const destFile = path.join(fnDir, yamlFile);
    fs.copyFileSync(srcFile, destFile);
    console.log(`Copied ${yamlFile} (${profileName}) -> ${path.relative(repoRoot, destFile)}`);
  }
}

export function resolveLinuxNativeBinary() {
  if (fs.existsSync(srcPkgDir)) {
    return srcPkgDir;
  }

  console.log(`${NATIVE_PKG} not found in node_modules (expected on Windows).`);
  console.log('Fetching Linux binary from npm registry via `npm pack`…');

  // Determine the correct native binding version from the libsql package's
  // optionalDependencies — the native bindings are versioned independently
  // from @libsql/client.
  const libsqlPkgJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'node_modules', 'libsql', 'package.json'), 'utf8')
  );
  const bindingVersion = libsqlPkgJson.optionalDependencies?.[NATIVE_PKG];
  if (!bindingVersion) {
    console.error(`Could not determine version for ${NATIVE_PKG} from libsql package.json.`);
    process.exit(1);
  }
  const pkgWithVersion = `${NATIVE_PKG}@${bindingVersion}`;

  const tmpDir = path.join(repoRoot, '.tmp-libsql-linux');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // npm pack downloads the tarball into tmpDir and prints its filename
    const tarball = execSync(`npm pack ${pkgWithVersion} --pack-destination "${tmpDir}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();

    const tarballPath = path.join(tmpDir, tarball);
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    // Node's built-in tar (v18+) or use npm's bundled one via npx
    execSync(`tar -xzf "${tarballPath}" -C "${extractDir}"`, { cwd: repoRoot });

    // npm pack always extracts into a "package/" subfolder
    const resolvedSrcDir = path.join(extractDir, 'package');

    if (!fs.existsSync(resolvedSrcDir)) {
      console.error(`Extraction failed: expected ${resolvedSrcDir} to exist.`);
      process.exit(1);
    }

    console.log(`Fetched ${pkgWithVersion} into temp dir.`);
    return resolvedSrcDir;
  } catch (err) {
    console.error(`Failed to fetch ${pkgWithVersion} from npm registry:`);
    console.error(err.message);
    console.error('');
    console.error('Manual workaround: run the following on a Linux machine or WSL, then copy');
    console.error(`the resulting directory to node_modules/${NATIVE_PKG}:`);
    console.error(`  npm install --no-save ${NATIVE_PKG}`);
    process.exit(1);
  }
}

export function patchFunctionArtifact(fn, resolvedSrcDir) {
  const fnDir = path.join(buildDir, fn);
  if (!fs.existsSync(fnDir)) {
    console.warn(`Skipping ${fn}: build output not found at ${fnDir}`);
    return false;
  }
  // The bundle calls createRequire(import.meta.url) from the artifact root
  // (/var/task), so the package must resolve at /var/task/node_modules/...
  const destPkgDir = path.join(fnDir, 'node_modules', NATIVE_PKG);
  fs.mkdirSync(path.dirname(destPkgDir), { recursive: true });
  fs.rmSync(destPkgDir, { recursive: true, force: true });
  fs.cpSync(resolvedSrcDir, destPkgDir, { recursive: true });
  console.log(`Copied ${NATIVE_PKG} -> ${path.relative(repoRoot, destPkgDir)}`);

  const lambdaMjsPath = path.join(fnDir, 'lambda.mjs');
  if (fs.existsSync(lambdaMjsPath)) {
    let content = fs.readFileSync(lambdaMjsPath, 'utf8');
    // Replace standalone __dirname and __filename to bypass ERR_AMBIGUOUS_MODULE_SYNTAX on Node 22
    content = content.replace(/\b__dirname\b/g, 'globalThis.__dirname');
    content = content.replace(/\b__filename\b/g, 'globalThis.__filename');
    fs.writeFileSync(lambdaMjsPath, content, 'utf8');
    console.log(`Patched ${fn}/lambda.mjs for Node 22 ESM compatibility`);
  }

  // Copy active profile configuration into artifact root (/var/task) for profile config loading
  const profileName = process.env.EVENT_PROFILE || DEFAULT_EVENT_PROFILE;
  try {
    copyProfileConfigs(profileName, fnDir, repoRoot);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  return true;
}

export function runPostBuild() {
  if (!fs.existsSync(buildDir)) {
    console.error(`Build directory not found: ${buildDir}`);
    console.error('Run `sam build` (from the aws-serverless/ directory) before this script.');
    process.exit(1);
  }

  // ── Resolve the Linux native binary ──────────────────────────────────────────
  // On Linux CI / Docker the package is installed natively. On Windows (dev
  // machines) npm installs the win32 binding instead, so we fetch the Linux
  // tarball from the npm registry on-the-fly using `npm pack` into a temp dir.

  const resolvedSrcDir = resolveLinuxNativeBinary();

  // ── Copy into each function artifact ─────────────────────────────────────────

  let copied = 0;
  for (const fn of functions) {
    if (patchFunctionArtifact(fn, resolvedSrcDir)) {
      copied += 1;
    }
  }

  // ── Cleanup temp dir ──────────────────────────────────────────────────────────

  const tmpDir = path.join(repoRoot, '.tmp-libsql-linux');
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Cleaned up temp directory.');
  }

  if (copied === 0) {
    console.error('No function artifacts were updated. Did `sam build` succeed?');
    process.exit(1);
  }

  generateStaticApiDocs();

  console.log(`Done. Patched ${copied} function artifact(s) with the libSQL native binary.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPostBuild();
}

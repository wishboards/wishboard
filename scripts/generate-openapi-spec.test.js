import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateOpenApiSpecFile } from './generate-openapi-spec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate-openapi-spec script', () => {
  const tempDir = path.join(os.tmpdir(), `openapi-spec-test-${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates a valid OpenAPI spec file at the specified path', () => {
    const outputPath = path.join(tempDir, 'nested', 'openapi.json');
    const content = generateOpenApiSpecFile(outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(content);
    expect(parsed.openapi).toBe('3.0.0');
    expect(parsed.info.title).toBe('Wishboard REST API');
    expect(parsed.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.paths['/api/config']).toBeDefined();
  });

  it('executes via CLI entrypoint using OPENAPI_SPEC_PATH without polluting working tree', () => {
    const outputPath = path.join(tempDir, 'cli', 'openapi.json');
    const scriptPath = path.resolve(__dirname, 'generate-openapi-spec.js');
    const stdout = execSync(`node "${scriptPath}"`, {
      stdio: 'pipe',
      env: { ...process.env, OPENAPI_SPEC_PATH: outputPath },
    }).toString();
    expect(stdout).toContain('Generated OpenAPI specification');
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});

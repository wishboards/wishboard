import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyProfileConfigs, generateStaticApiDocs } from './post-build.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

describe('post-build copyProfileConfigs', () => {
  it('copies all profile YAML files including stickers.yaml into the function directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-postbuild-test-'));
    try {
      copyProfileConfigs('lifestyle', tmpDir, repoRoot);

      expect(fs.existsSync(path.join(tmpDir, 'profile.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'stickers.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rules.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'demo_seeds.yaml'))).toBe(true);

      const stickersContent = fs.readFileSync(path.join(tmpDir, 'stickers.yaml'), 'utf8');
      expect(stickersContent).toContain('stickers:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('copies all profile YAML files for the professional profile', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-postbuild-prof-'));
    try {
      copyProfileConfigs('professional', tmpDir, repoRoot);

      expect(fs.existsSync(path.join(tmpDir, 'profile.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'stickers.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rules.yaml'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws an error if profile directory does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-postbuild-err-'));
    try {
      expect(() => copyProfileConfigs('nonexistent-profile', tmpDir, repoRoot)).toThrow(
        /Event profile 'nonexistent-profile' not found/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws an error if profile.yaml is missing in the profile directory', () => {
    const mockRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mockrepo-'));
    const mockProfileDir = path.join(mockRepo, 'profiles', 'broken');
    fs.mkdirSync(mockProfileDir, { recursive: true });
    fs.writeFileSync(path.join(mockProfileDir, 'stickers.yaml'), 'stickers: {}');

    const destDir = path.join(mockRepo, 'dest');
    fs.mkdirSync(destDir, { recursive: true });

    try {
      expect(() => copyProfileConfigs('broken', destDir, mockRepo)).toThrow(
        /missing profile\.yaml/
      );
    } finally {
      fs.rmSync(mockRepo, { recursive: true, force: true });
    }
  });
});

describe('post-build generateStaticApiDocs', () => {
  it('generates openapi.json, api-docs/index.html, and api/docs/index.html in dist', () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-postbuild-dist-'));
    try {
      generateStaticApiDocs(tmpDist);

      const openApiFile = path.join(tmpDist, 'openapi.json');
      expect(fs.existsSync(openApiFile)).toBe(true);
      const spec = JSON.parse(fs.readFileSync(openApiFile, 'utf8'));
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info.title).toBe('Wishboard REST API');

      const apiDocsIndex = path.join(tmpDist, 'api-docs', 'index.html');
      expect(fs.existsSync(apiDocsIndex)).toBe(true);
      const html = fs.readFileSync(apiDocsIndex, 'utf8');
      expect(html).toContain('Wishboard API Reference');

      const apiSubdocsIndex = path.join(tmpDist, 'api', 'docs', 'index.html');
      expect(fs.existsSync(apiSubdocsIndex)).toBe(true);
      const subHtml = fs.readFileSync(apiSubdocsIndex, 'utf8');
      expect(subHtml).toContain('Wishboard API Reference');

      const apiDocsHtml = path.join(tmpDist, 'api-docs.html');
      expect(fs.existsSync(apiDocsHtml)).toBe(true);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it('gracefully skips if distDir does not exist without throwing', () => {
    const nonExistent = path.join(os.tmpdir(), 'wb-nonexistent-dist-' + Date.now());
    expect(() => generateStaticApiDocs(nonExistent)).not.toThrow();
    expect(fs.existsSync(nonExistent)).toBe(false);
  });
});

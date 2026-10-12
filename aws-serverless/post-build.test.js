import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyProfileConfigs } from './post-build.js';

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

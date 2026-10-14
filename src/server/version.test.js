import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { getApiVersion, getAppVersion, resetVersionCache } from './version.js';

describe('version helper', () => {
  beforeEach(() => {
    resetVersionCache();
    vi.restoreAllMocks();
  });

  it('reads API version from api/version.txt', () => {
    const version = getApiVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('caches API version on subsequent calls', () => {
    const first = getApiVersion();
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const second = getApiVersion();
    expect(second).toBe(first);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('falls back to 1.0.0 when api/version.txt does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(getApiVersion()).toBe('1.0.0');
  });

  it('falls back to 1.0.0 when reading api/version.txt throws an error', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(getApiVersion()).toBe('1.0.0');
  });

  it('reads App version from package.json', () => {
    const version = getAppVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('caches App version on subsequent calls', () => {
    const first = getAppVersion();
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const second = getAppVersion();
    expect(second).toBe(first);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('falls back to 1.0.0 when package.json does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(getAppVersion()).toBe('1.0.0');
  });

  it('falls back to 1.0.0 when package.json has no version property', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'wishboard' }));
    expect(getAppVersion()).toBe('1.0.0');
  });

  it('falls back to 1.0.0 when package.json contains invalid JSON', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('invalid-json');
    expect(getAppVersion()).toBe('1.0.0');
  });
});

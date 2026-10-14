import { describe, expect, it, vi } from 'vitest';
import { generatePassphrase } from './passphrase.js';

describe('generatePassphrase', () => {
  it('returns a passphrase with three non-empty valid segments', () => {
    for (let i = 0; i < 100; i++) {
      const passphrase = generatePassphrase();
      expect(passphrase).toBeTypeOf('string');
      const parts = passphrase.split('-');
      expect(parts).toHaveLength(3);
      expect(
        parts.every((segment: string) => segment.trim().length > 0 && segment !== 'undefined')
      ).toBe(true);
    }
  });

  it('always returns a string with two hyphens', () => {
    for (let i = 0; i < 100; i++) {
      const passphrase = generatePassphrase();
      expect(passphrase.split('-')).toHaveLength(3);
      expect(passphrase).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    }
  });

  it('throws a TypeError if no crypto is available', async () => {
    const originalCrypto = globalThis.crypto;
    delete (globalThis as Record<string, unknown>).crypto;

    vi.resetModules();
    // @ts-expect-error - cache-busting query parameter is not in declarations
    await expect(import('./passphrase.js?error-fallback')).rejects.toThrow(
      'No secure crypto available in this environment.'
    );

    globalThis.crypto = originalCrypto;
  });
});

describe('randomIndex', () => {
  it('returns 0 if max is <= 1', async () => {
    const { randomIndex } = await import('./passphrase.js');
    expect(randomIndex(1)).toBe(0);
    expect(randomIndex(0)).toBe(0);
    expect(randomIndex(-5)).toBe(0);
  });

  it('retries when random value is >= limit', async () => {
    let callCount = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: any) => {
        if (callCount === 0) {
          array[0] = 4294967295; // Forces retry for max=3
        } else {
          array[0] = 0; // Valid
        }
        callCount++;
        return array;
      },
    });

    // @ts-expect-error - cache-busting query parameter is not in declarations
    const { randomIndex } = await import('./passphrase.js?test=retry');

    expect(randomIndex(3)).toBe(0);
    expect(callCount).toBe(2);

    vi.unstubAllGlobals();
  });
});

import { delay } from '../utils/testUtils';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useExcludedWishes } from './useExcludedWishes';
import { useAuth } from '../AuthContext';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockAuth = (overrides: { token: string | null; user: any }) =>
  vi.mocked(useAuth).mockReturnValue({
    token: overrides.token,
    user: overrides.user,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    setTokenExternally: vi.fn(),
  } as any);

describe('useExcludedWishes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.fetch = vi.fn() as any;
  });

  it('loads exclusions from localStorage for anonymous users', async () => {
    mockAuth({ token: null, user: null });
    localStorage.setItem('wishboard.excludedWishes', JSON.stringify(['w1', 'w2']));

    const { result } = renderHook(() => useExcludedWishes());

    expect(result.current.loading).toBe(false);
    expect(result.current.excludedIds).toEqual(['w1', 'w2']);
    expect(result.current.isExcluded('w1')).toBe(true);
    expect(result.current.isExcluded('w3')).toBe(false);
  });

  it('handles corrupt localStorage gracefully', async () => {
    mockAuth({ token: null, user: null });
    localStorage.setItem('wishboard.excludedWishes', 'invalid-json');

    const { result } = renderHook(() => useExcludedWishes());

    expect(result.current.loading).toBe(false);
    expect(result.current.excludedIds).toEqual([]);
  });

  it('handles localStorage.getItem error gracefully', async () => {
    mockAuth({ token: null, user: null });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock getItem to throw an error
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage is disabled');
    });

    const { result } = renderHook(() => useExcludedWishes());

    expect(result.current.loading).toBe(false);
    expect(result.current.excludedIds).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to load wish exclusions from localStorage:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it('excludes a wish in localStorage for anonymous users', async () => {
    mockAuth({ token: null, user: null });

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await result.current.excludeWish('w1');
    });

    expect(result.current.excludedIds).toEqual(['w1']);
    expect(JSON.parse(localStorage.getItem('wishboard.excludedWishes') || '[]')).toEqual(['w1']);

    // Cover the `if (prev.includes(wishId)) return prev;` early return in local mode
    await act(async () => {
      await result.current.excludeWish('w1');
    });
    expect(result.current.excludedIds).toEqual(['w1']);
  });

  it('unexcludes a wish in localStorage for anonymous users', async () => {
    mockAuth({ token: null, user: null });
    localStorage.setItem('wishboard.excludedWishes', JSON.stringify(['w1', 'w2']));

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await result.current.unexcludeWish('w1');
    });

    expect(result.current.excludedIds).toEqual(['w2']);
    expect(JSON.parse(localStorage.getItem('wishboard.excludedWishes') || '[]')).toEqual(['w2']);
  });

  it('loads exclusions from server for authenticated users', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['w1', 'w3'],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    // Wait for the state update in useEffect
    await act(async () => {
      await delay(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.excludedIds).toEqual(['w1', 'w3']);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/exclusions/list', {
      headers: {
        Authorization: 'Bearer my-token',
      },
    });
  });

  it('excludes a wish on server for authenticated users', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    // Wait for initial load
    await act(async () => {
      await delay(0);
    });

    // Mock subsequent fetch calls for exclude
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
    }) as any;

    await act(async () => {
      await result.current.excludeWish('w4');
    });

    expect(result.current.excludedIds).toEqual(['w4']);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/w4/exclude', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-token',
      },
    });
  });

  it('reverts optimistic update on exclude failure', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    // Mock exclude call to fail
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    }) as any;

    await act(async () => {
      await result.current.excludeWish('w4');
    });

    // Should revert back to empty
    expect(result.current.excludedIds).toEqual([]);
  });

  it('unexcludes a wish on server for authenticated users', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['w1'],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
    }) as any;

    await act(async () => {
      await result.current.unexcludeWish('w1');
    });

    expect(result.current.excludedIds).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/w1/exclude', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer my-token',
      },
    });
  });

  it('reverts optimistic update on unexclude failure', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['w1'],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    }) as any;

    await act(async () => {
      await result.current.unexcludeWish('w1');
    });

    // Should revert back to containing w1
    expect(result.current.excludedIds).toEqual(['w1']);

    // Call unexcludeWish while it's NOT in the list to hit the early return
    // Wait, the early return in the revert is if it is ALREADY in the list.
    // If we call unexcludeWish on 'w2' (not in list), it optimistically removes it (list is still ['w1']).
    // Then on revert, it adds it back to the list: ['w1', 'w2'].
    // If we call unexcludeWish on 'w2', and concurrently add it back so the revert sees it already there...
    // The easiest way is to mock `setExcludedIds` or `useState`. Since we can't do that easily,
    // we can accept leaving that one branch uncovered or use a simpler concurrent test.
  });

  it('handles network error during initial load from server', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result, unmount } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.excludedIds).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to load wish exclusions from server:',
      expect.any(Error)
    );

    unmount(); // Unmount triggers the `if (active) setLoading(false);` case where active is false

    consoleErrorSpy.mockRestore();
  });

  it('handles network error during excludeWish on server', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await act(async () => {
      await result.current.excludeWish('w4');
    });

    expect(result.current.excludedIds).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to exclude wish on server:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('handles network error during unexcludeWish on server', async () => {
    mockAuth({ token: 'my-token', user: { id: 'u1' } as any });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['w1'],
    }) as any;

    const { result } = renderHook(() => useExcludedWishes());

    await act(async () => {
      await delay(0);
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await act(async () => {
      await result.current.unexcludeWish('w1');
    });

    expect(result.current.excludedIds).toEqual(['w1']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to remove wish exclusion on server:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});

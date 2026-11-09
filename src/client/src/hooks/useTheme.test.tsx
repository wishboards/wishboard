import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTheme,
  STORAGE_PREFERENCES_KEY,
  getStoredPreferences,
  setStoredPreferences,
} from './useTheme';

const useAuthMock = vi.fn();
const useEventProfileMock = vi.fn();

vi.mock('../AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../EventProfileContext', () => ({
  useEventProfile: () => useEventProfileMock(),
}));

describe('useTheme hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--wb-accent-primary');

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      refreshUser: vi.fn(),
    });

    useEventProfileMock.mockReturnValue({
      branding: {
        themePreset: 'midnight',
        accentColor: '#f59e0b',
        boardTitle: 'Wishboard',
        tagline: 'Pin your convention wishes',
      },
    });
  });

  afterEach(() => {
    globalThis.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--wb-accent-primary');
  });

  it('initializes with host-default and applies midnight preset to documentElement', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.themeMode).toBe('host-default');
    expect(result.current.effectiveTheme).toBe('midnight');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('#f59e0b');
  });

  it('uses host branding preset when themeMode is host-default', () => {
    useEventProfileMock.mockReturnValue({
      branding: {
        themePreset: 'daylight',
        accentColor: '#2563eb',
      },
    });

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('daylight');
    expect(document.documentElement.getAttribute('data-theme')).toBe('daylight');
  });

  it('allows unauthenticated users to switch themes and persists in localStorage', async () => {
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setThemeMode('corkhouse');
    });

    expect(result.current.themeMode).toBe('corkhouse');
    expect(result.current.effectiveTheme).toBe('corkhouse');
    expect(document.documentElement.getAttribute('data-theme')).toBe('corkhouse');

    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_PREFERENCES_KEY) || '{}');
    expect(stored.themeMode).toBe('corkhouse');
  });

  it('persists theme preference to server when authenticated', async () => {
    const refreshUserMock = vi.fn();
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        username: 'alice',
        ui_preferences: { themeMode: 'host-default' },
      },
      token: 'jwt-alice',
      refreshUser: refreshUserMock,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as any);

    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setThemeMode('high-contrast');
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/me',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-alice',
        }),
        body: JSON.stringify({
          ui_preferences: { themeMode: 'high-contrast' },
        }),
      })
    );
    expect(refreshUserMock).toHaveBeenCalled();
  });

  it('handles getStoredPreferences and setStoredPreferences edge cases', () => {
    setStoredPreferences({ themeMode: 'daylight' });
    expect(getStoredPreferences().themeMode).toBe('daylight');

    globalThis.localStorage.setItem(STORAGE_PREFERENCES_KEY, 'invalid-json');
    expect(getStoredPreferences().themeMode).toBe('host-default');

    // Test localStorage error in setStoredPreferences
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    setStoredPreferences({ themeMode: 'midnight' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('handles network failure gracefully when persisting theme preference to server', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        username: 'alice',
        ui_preferences: { themeMode: 'host-default' },
      },
      token: 'jwt-alice',
      refreshUser: vi.fn(),
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setThemeMode('high-contrast');
    });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('ignores invalid theme modes passed to setThemeMode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      // @ts-expect-error testing invalid theme runtime guard
      await result.current.setThemeMode('invalid-neon-theme');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

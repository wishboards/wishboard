import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTheme,
  STORAGE_PREFERENCES_KEY,
  getStoredPreferences,
  setStoredPreferences,
  resolveBoardTextureCss,
} from './useTheme';
import { getSocket } from './useWebSocket';

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

  it('dynamically updates :root CSS variables and dataset attributes when sys:branding WebSocket event is received', () => {
    const { result } = renderHook(() => useTheme());
    const socket = getSocket();

    const brandingListener = vi
      .mocked(socket.on)
      .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

    expect(brandingListener).toBeDefined();

    act(() => {
      brandingListener({
        themePreset: 'daylight',
        accentColor: '#10b981',
        primaryColor: '#059669',
        surfaceColor: 'rgba(255, 255, 255, 0.95)',
        boardTitle: 'Solar Fest',
        tagline: 'Bright ideas',
        boardTexture: 'linen',
        logoUrl: '/images/live-logo.png',
        boardBgUrl: null,
      });
    });

    expect(result.current.branding.boardTitle).toBe('Solar Fest');
    expect(result.current.effectiveTheme).toBe('daylight');
    expect(document.documentElement.dataset.theme).toBe('daylight');
    expect(document.documentElement.dataset.boardTexture).toBe('linen');
    expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('#10b981');
    expect(document.documentElement.style.getPropertyValue('--wb-accent-hover')).toBe('#059669');
    expect(document.documentElement.style.getPropertyValue('--wb-bg-surface')).toBe(
      'rgba(255, 255, 255, 0.95)'
    );
    expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe(
      "url('/images/live-logo.png')"
    );
    expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
      "url('/textures/linen.webp')"
    );
  });

  it('preserves attendee personal theme preference while updating host brand assets on sys:branding', async () => {
    const { result } = renderHook(() => useTheme());
    const socket = getSocket();

    await act(async () => {
      await result.current.setThemeMode('corkhouse');
    });

    expect(result.current.effectiveTheme).toBe('corkhouse');
    expect(document.documentElement.dataset.theme).toBe('corkhouse');

    const brandingListener = vi
      .mocked(socket.on)
      .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

    act(() => {
      brandingListener({
        themePreset: 'daylight',
        boardTitle: 'Host Convention',
        logoUrl: '/images/con-logo.webp',
        boardTexture: 'slate',
      });
    });

    // Attendee personal theme remains corkhouse
    expect(result.current.effectiveTheme).toBe('corkhouse');
    expect(document.documentElement.dataset.theme).toBe('corkhouse');

    // Host brand assets update
    expect(result.current.branding.boardTitle).toBe('Host Convention');
    expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe(
      "url('/images/con-logo.webp')"
    );
    expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
      "url('/textures/slate.webp')"
    );
    expect(document.documentElement.dataset.boardTexture).toBe('slate');
  });

  it('correctly cleans up sys:branding listener upon unmount', () => {
    const socket = getSocket();
    const { unmount } = renderHook(() => useTheme());

    const offSpy = vi.spyOn(socket, 'off');
    unmount();

    expect(offSpy).toHaveBeenCalledWith('sys:branding', expect.any(Function));
  });

  it('resolveBoardTextureCss resolves all supported texture types and custom URLs', () => {
    expect(resolveBoardTextureCss('cork')).toBe("url('/textures/cork.webp')");
    expect(resolveBoardTextureCss('slate')).toBe("url('/textures/slate.webp')");
    expect(resolveBoardTextureCss('linen')).toBe("url('/textures/linen.webp')");
    expect(resolveBoardTextureCss('custom', '/images/custom-bg.png')).toBe(
      "url('/images/custom-bg.png')"
    );
    expect(resolveBoardTextureCss('custom', null)).toBe('none');
    expect(resolveBoardTextureCss('none')).toBe('none');
    expect(resolveBoardTextureCss(undefined)).toBe("url('/textures/cork.webp')");
    // If bgUrl is provided regardless of texture, it takes precedence
    expect(resolveBoardTextureCss('cork', '/images/override.png')).toBe(
      "url('/images/override.png')"
    );
  });
});

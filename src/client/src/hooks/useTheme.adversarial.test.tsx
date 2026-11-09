import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';
import { getSocket } from './useWebSocket';

const useAuthMock = vi.fn();
const useEventProfileMock = vi.fn();

vi.mock('../AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../EventProfileContext', () => ({
  useEventProfile: () => useEventProfileMock(),
}));

describe('useTheme — Adversarial & Stress Testing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-board-texture');
    document.documentElement.style.removeProperty('--wb-accent-primary');
    document.documentElement.style.removeProperty('--wb-accent-hover');
    document.documentElement.style.removeProperty('--wb-bg-surface');
    document.documentElement.style.removeProperty('--wb-brand-logo-url');
    document.documentElement.style.removeProperty('--wb-board-texture');
    document.documentElement.style.removeProperty('--wb-board-bg-url');

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      refreshUser: vi.fn(),
    });

    useEventProfileMock.mockReturnValue({
      branding: {
        themePreset: 'midnight',
        accentColor: '#f59e0b',
        primaryColor: '#fbbf24',
        surfaceColor: 'rgba(30, 41, 59, 0.78)',
        boardTexture: 'cork',
        boardTitle: 'Wishboard',
        tagline: 'Pin your convention wishes',
        logoUrl: null,
        boardBgUrl: null,
      },
    });
  });

  afterEach(() => {
    globalThis.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-board-texture');
    document.documentElement.style.removeProperty('--wb-accent-primary');
    document.documentElement.style.removeProperty('--wb-accent-hover');
    document.documentElement.style.removeProperty('--wb-bg-surface');
    document.documentElement.style.removeProperty('--wb-brand-logo-url');
    document.documentElement.style.removeProperty('--wb-board-texture');
    document.documentElement.style.removeProperty('--wb-board-bg-url');
  });

  describe('High-Frequency WebSocket Event Bursts', () => {
    it('handles 50 rapid sequential sys:branding events without corruption or memory leaks', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      expect(brandingListener).toBeDefined();

      const presets = ['midnight', 'daylight', 'corkhouse', 'high-contrast'] as const;
      const textures = ['cork', 'slate', 'linen', 'none'] as const;

      act(() => {
        for (let i = 0; i < 50; i++) {
          const preset = presets[i % presets.length];
          const texture = textures[i % textures.length];
          brandingListener({
            themePreset: preset,
            accentColor: `#${String(i).padStart(6, '0')}`,
            primaryColor: `#${String(99 - i).padStart(6, '0')}`,
            surfaceColor: `rgba(${i}, ${i}, ${i}, 0.8)`,
            boardTitle: `Stress Title #${i}`,
            boardTexture: texture,
            logoUrl: i % 2 === 0 ? `/images/logo-${i}.png` : null,
            boardBgUrl: i % 3 === 0 ? `/images/bg-${i}.webp` : null,
          });
        }
      });

      // Verify final state (i = 49)
      // 49 % 4 = 1 -> 'daylight'
      // 49 % 4 = 1 -> 'slate'
      expect(result.current.branding.boardTitle).toBe('Stress Title #49');
      expect(result.current.effectiveTheme).toBe('daylight');
      expect(document.documentElement.dataset.theme).toBe('daylight');
      expect(document.documentElement.dataset.boardTexture).toBe('slate');
      expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe(
        '#000049'
      );
      expect(document.documentElement.style.getPropertyValue('--wb-accent-hover')).toBe('#000050');
      expect(document.documentElement.style.getPropertyValue('--wb-bg-surface')).toBe(
        'rgba(49, 49, 49, 0.8)'
      );
      // 49 % 2 !== 0 -> logoUrl is null
      expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe('');
      // 49 % 3 !== 0 -> boardBgUrl is null, texture is slate
      expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
        "url('/textures/slate.webp')"
      );
    });
  });

  describe('Corrupt, Null, and Primitive WebSocket Payloads', () => {
    it('safely ignores null, undefined, and non-object payloads', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      expect(brandingListener).toBeDefined();

      const initialTitle = result.current.branding.boardTitle;

      act(() => {
        // Send corrupt primitives
        // @ts-expect-error testing runtime guard against null
        brandingListener(null);
        // @ts-expect-error testing runtime guard against undefined
        brandingListener(undefined);
        // @ts-expect-error testing runtime guard against number
        brandingListener(42);
        // @ts-expect-error testing runtime guard against string
        brandingListener('malicious payload');
        // @ts-expect-error testing runtime guard against boolean
        brandingListener(true);
      });

      // State is preserved and untouched
      expect(result.current.branding.boardTitle).toBe(initialTitle);
      expect(result.current.effectiveTheme).toBe('midnight');
    });

    it('handles empty object {} without crashing, falling back to defaults', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      act(() => {
        brandingListener({});
      });

      expect(result.current.effectiveTheme).toBe('midnight');
      expect(document.documentElement.dataset.theme).toBe('midnight');
      expect(document.documentElement.dataset.boardTexture).toBe('cork');
      expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
        "url('/textures/cork.webp')"
      );
      expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('');
    });

    it('handles payloads with all-null and all-undefined fields safely', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      act(() => {
        brandingListener({
          themePreset: undefined,
          primaryColor: undefined,
          accentColor: undefined,
          surfaceColor: undefined,
          boardTitle: undefined,
          tagline: undefined,
          boardTexture: undefined,
          logoUrl: null,
          boardBgUrl: null,
        });
      });

      expect(result.current.effectiveTheme).toBe('midnight');
      expect(document.documentElement.dataset.theme).toBe('midnight');
      expect(document.documentElement.dataset.boardTexture).toBe('cork');
      expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
        "url('/textures/cork.webp')"
      );
      expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-board-bg-url')).toBe('');
    });

    it('prevents prototype pollution via WebSocket payload', () => {
      const socket = getSocket();
      renderHook(() => useTheme());

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      const poisonedPayload = JSON.parse(
        '{"__proto__": {"polluted": true}, "boardTitle": "Clean Title"}'
      );

      act(() => {
        brandingListener(poisonedPayload);
      });

      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('CSS Injection Resilience & Personal Theme Isolation', () => {
    it('handles CSS injection strings in boardBgUrl safely without leaking properties or throwing', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      act(() => {
        brandingListener({
          boardTexture: 'custom',
          boardBgUrl: "test.png'); background: red; /*",
        });
      });

      expect(result.current.branding.boardBgUrl).toBe("test.png'); background: red; /*");
      // The CSS parser in documentElement.style rejects injection of separate rules, preventing property breakout
      expect(document.documentElement.style.getPropertyValue('background')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-board-bg-url')).toBe('');
    });

    it('strictly isolates attendee personal theme choice during rapid host updates', async () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      // Attendee explicitly chooses 'high-contrast'
      await act(async () => {
        await result.current.setThemeMode('high-contrast');
      });

      expect(result.current.effectiveTheme).toBe('high-contrast');
      expect(document.documentElement.dataset.theme).toBe('high-contrast');

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      // Host fires rapid events with other presets
      act(() => {
        for (let i = 0; i < 10; i++) {
          brandingListener({
            themePreset: i % 2 === 0 ? 'midnight' : 'daylight',
            boardTitle: `Host Event v${i}`,
            logoUrl: `/images/logo-${i}.png`,
            boardTexture: 'linen',
          });
        }
      });

      // Attendee's theme remains high-contrast (personal preference honored)
      expect(result.current.effectiveTheme).toBe('high-contrast');
      expect(document.documentElement.dataset.theme).toBe('high-contrast');

      // But host's boardTitle, logo, and texture update in real time
      expect(result.current.branding.boardTitle).toBe('Host Event v9');
      expect(document.documentElement.dataset.boardTexture).toBe('linen');
      expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe(
        "url('/images/logo-9.png')"
      );
    });
  });
});

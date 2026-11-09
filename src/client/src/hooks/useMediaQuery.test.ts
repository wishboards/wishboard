import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useMediaQuery, useIsMobile } from './useMediaQuery';

describe('useMediaQuery', () => {
  const originalMatchMedia = globalThis.matchMedia;

  afterEach(() => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('returns initial matching value when matchMedia returns true', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);
  });

  it('returns initial matching value when matchMedia returns false', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);
  });

  it('updates state when media query change event fires', () => {
    let listener: ((e: MediaQueryListEvent) => void) | null = null;

    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn().mockImplementation((_event, cb) => {
          listener = cb;
        }),
        removeEventListener: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);

    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it('supports legacy addListener and removeListener fallback', () => {
    let listener: ((e: MediaQueryListEvent) => void) | null = null;
    const removeListenerMock = vi.fn();

    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addListener: vi.fn().mockImplementation((cb) => {
          listener = cb;
        }),
        removeListener: removeListenerMock,
      })),
    });

    const { result, unmount } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(true);

    act(() => {
      listener?.({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current).toBe(false);

    unmount();
    expect(removeListenerMock).toHaveBeenCalled();
  });

  it('returns false gracefully when globalThis.matchMedia is undefined', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);
  });

  it('useIsMobile queries (max-width: 767px)', () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });

    const { result } = renderHook(() => useIsMobile());
    expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 767px)');
    expect(result.current).toBe(true);
  });
});

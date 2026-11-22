import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  fetchPendingSuggestionsCount,
  useWishSuggestionsRealtime,
} from './useWishSuggestionsRealtime';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('./useWebSocket', () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));

describe('useWishSuggestionsRealtime', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('no-ops when wishId is absent', () => {
    const onPendingCountChange = vi.fn();
    renderHook(() => useWishSuggestionsRealtime({ wishId: null, onPendingCountChange }));
    expect(mockSocket.on).not.toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('subscribes, ignores mismatched wish_id, updates on matching wish_id, skips timers when aiEnabled is false, and unsubscribes on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 's1', status: 'pending' },
          { id: 's2', status: 'accepted' },
          { id: 's3', status: 'pending' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const onPendingCountChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWishSuggestionsRealtime({
        wishId: 'w-123',
        secret: 'sec-1',
        token: 'tok-1',
        onPendingCountChange,
      })
    );

    expect(mockSocket.emit).toHaveBeenCalledWith('subscribe', {
      channel: 'wish:suggestions:w-123',
      token: 'tok-1',
      secret: 'sec-1',
    });
    expect(vi.getTimerCount()).toBe(0);

    const handler = mockSocket.on.mock.calls.find(
      ([evt]) => evt === 'wish:ai_suggestions_ready'
    )?.[1];
    expect(handler).toBeTypeOf('function');

    // Mismatched wish_id or missing payload should not trigger updates
    act(() => {
      handler(undefined);
      handler({ wish_id: 'other-wish' });
    });
    expect(onPendingCountChange).not.toHaveBeenCalled();

    // Matching wish_id triggers immediate optimistic update and authenticated count refresh
    await act(async () => {
      handler({ wish_id: 'w-123' });
      await Promise.resolve();
    });
    const updaterFn = onPendingCountChange.mock.calls[0][0] as (prev: number) => number;
    expect(updaterFn(0)).toBe(1);
    expect(updaterFn(3)).toBe(3);
    expect(onPendingCountChange).toHaveBeenCalledWith(2);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0];
    expect(String(reqUrl)).toContain('secret=sec-1');
    expect((reqInit as RequestInit)?.headers).toBeDefined();

    // When fetch returns null (500), onPendingCountChange is not called with null
    fetchMock.mockResolvedValueOnce(new Response('Err', { status: 500 }));
    onPendingCountChange.mockClear();
    await act(async () => {
      handler({ wish_id: 'w-123' });
      await Promise.resolve();
    });
    expect(onPendingCountChange).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('wish:ai_suggestions_ready', handler);
    expect(mockSocket.emit).toHaveBeenCalledWith('unsubscribe', {
      channel: 'wish:suggestions:w-123',
    });
  });

  it('runs fallback checks with credentials when aiEnabled is true and clears checking state on timeout or pending > 0', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 's1', status: 'pending' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('Err', { status: 500 }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const onPendingCountChange = vi.fn();
    const onCheckingDone = vi.fn();

    renderHook(() =>
      useWishSuggestionsRealtime({
        wishId: 'w-ai',
        secret: 'sec-2',
        token: 'tok-2',
        aiEnabled: true,
        onPendingCountChange,
        onCheckingDone,
      })
    );

    // 350ms check returns 0 pending -> does not call onCheckingDone yet
    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('secret=sec-2');
    expect(onPendingCountChange).toHaveBeenCalledWith(0);
    expect(onCheckingDone).not.toHaveBeenCalled();

    // 2500ms check returns 1 pending -> calls onCheckingDone
    await act(async () => {
      vi.advanceTimersByTime(2150);
      await Promise.resolve();
    });
    expect(onPendingCountChange).toHaveBeenCalledWith(1);
    expect(onCheckingDone).toHaveBeenCalledTimes(1);

    // 6000ms check returns 500 (null) -> does not call onPendingCountChange with null
    onPendingCountChange.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    expect(onPendingCountChange).not.toHaveBeenCalled();

    // 8000ms timeout guard invokes onCheckingDone cleanly
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });
    expect(onCheckingDone).toHaveBeenCalledTimes(2);
  });

  it('clears timers and ignores late responses on unmount, and handles fetch errors', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network down')) as typeof globalThis.fetch;
    expect(await fetchPendingSuggestionsCount('w-err', {})).toBeNull();

    let resolveLate!: (res: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveLate = resolve;
        })
    ) as typeof globalThis.fetch;

    const onPendingCountChange = vi.fn();
    const onCheckingDone = vi.fn();
    const { unmount } = renderHook(() =>
      useWishSuggestionsRealtime({
        wishId: 'w-unmount',
        aiEnabled: true,
        onPendingCountChange,
        onCheckingDone,
      })
    );

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Trigger socket handler, then unmount before fetch resolves
    const handler = mockSocket.on.mock.calls.find(
      ([evt]) => evt === 'wish:ai_suggestions_ready'
    )?.[1];
    act(() => {
      handler({ wish_id: 'w-unmount' });
    });
    onPendingCountChange.mockClear();

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      resolveLate(
        new Response(JSON.stringify([{ id: 's1', status: 'pending' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await Promise.resolve();
    });
    expect(onPendingCountChange).not.toHaveBeenCalled();
  });
});

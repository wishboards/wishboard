import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { io } from 'socket.io-client';
import DisplayPage from './DisplayPage';

class ResizeObserverMock {
  observe() {
    /* noop */
  }
  unobserve() {
    /* noop */
  }
  disconnect() {
    /* noop */
  }
}

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

// Helper: get the mock socket produced by the mocked socket.io-client
const getMockSocket = () => (io as any)();

describe('DisplayPage WebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'w1', content: 'Existing wish' }],
    }) as any;
    globalThis.setInterval = vi.fn(() => 42) as any;
    globalThis.clearInterval = vi.fn() as any;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });

  it('pins a new wish to the top when wish:created is received', async () => {
    render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Existing wish')).toBeInTheDocument());

    const socket = getMockSocket();
    const wishCreatedHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'wish:created'
    )?.[1];
    expect(wishCreatedHandler).toBeDefined();

    act(() => {
      wishCreatedHandler({
        id: 'w2',
        content: 'Live new wish',
      });
    });

    await waitFor(() => expect(screen.getByText('Live new wish')).toBeInTheDocument());
    // Both wishes should be visible
    expect(screen.getByText('Existing wish')).toBeInTheDocument();
  });

  it('resets the rotation timer when a new wish arrives', async () => {
    render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Existing wish')).toBeInTheDocument());

    const intervalCallsBefore = (globalThis.setInterval as ReturnType<typeof vi.fn>).mock.calls
      .length;

    const socket = getMockSocket();
    const wishCreatedHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'wish:created'
    )?.[1];

    act(() => {
      wishCreatedHandler({
        id: 'w2',
        content: 'Timer reset wish',
      });
    });

    // clearInterval + new setInterval should have been called again for the timer reset
    expect(
      (globalThis.clearInterval as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(0);
    expect((globalThis.setInterval as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      intervalCallsBefore
    );
  });

  it('caps the wish list at capacity when new wishes arrive', async () => {
    // Return 12 wishes initially so the list is at capacity
    const initialWishes = Array.from({ length: 12 }, (_, i) => ({
      id: `w${i}`,
      content: `Wish ${i}`,
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => initialWishes,
    }) as any;

    render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Wish 0')).toBeInTheDocument());

    const socket = getMockSocket();
    const wishCreatedHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'wish:created'
    )?.[1];

    act(() => {
      wishCreatedHandler({
        id: 'w-new',
        content: 'Brand new wish',
      });
    });

    await waitFor(() => expect(screen.getByText('Brand new wish')).toBeInTheDocument());
    // Last wish (Wish 11) should have been dropped
    expect(screen.queryByText('Wish 11')).not.toBeInTheDocument();
  });

  it('subscribes to wish:* on mount and removes listener on unmount', async () => {
    const { unmount } = render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Existing wish')).toBeInTheDocument());

    const socket = getMockSocket();
    expect(socket.emit).toHaveBeenCalledWith('subscribe', { channel: 'wish:*' });

    unmount();

    expect(socket.emit).toHaveBeenCalledWith('unsubscribe', { channel: 'wish:*' });
    expect(socket.off).toHaveBeenCalledWith('wish:created', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('wish:deleted', expect.any(Function));
  });

  it('removes deleted wish from active wishes and pinned wishes when wish:deleted is received', async () => {
    render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Existing wish')).toBeInTheDocument());

    const socket = getMockSocket();
    const wishCreatedHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'wish:created'
    )?.[1];
    const wishDeletedHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'wish:deleted'
    )?.[1];

    expect(wishDeletedHandler).toBeDefined();

    // Pin a live wish
    act(() => {
      wishCreatedHandler({
        id: 'pinned-1',
        content: 'Pinned wish to delete',
      });
    });
    await waitFor(() => expect(screen.getByText('Pinned wish to delete')).toBeInTheDocument());

    // Delete both the existing wish and the pinned wish
    act(() => {
      wishDeletedHandler('pinned-1');
      wishDeletedHandler('w1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Pinned wish to delete')).not.toBeInTheDocument();
      expect(screen.queryByText('Existing wish')).not.toBeInTheDocument();
    });
  });
});

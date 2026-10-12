import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import DisplayPage from './DisplayPage';
import { useEventProfile } from '../EventProfileContext';

// Mock ResizeObserver for jsdom
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

describe('DisplayPage', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'wish-1',
          content: 'Big screen wish',
        },
      ],
    }) as any;
    globalThis.setInterval = vi.fn(() => 1) as any;
    globalThis.clearInterval = vi.fn() as any;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });

  it('loads and renders wishes from the random endpoint with default limit=12 when not in kiosk mode', async () => {
    render(<DisplayPage isKiosk={false} />);

    await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/random?limit=12');
  });

  it('calls onEnterKiosk when Enter Kiosk Mode button is clicked', async () => {
    const onEnterKiosk = vi.fn();
    render(<DisplayPage isKiosk={false} onEnterKiosk={onEnterKiosk} />);

    await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: 'Enter Kiosk Mode' });
    fireEvent.click(btn);
    expect(onEnterKiosk).toHaveBeenCalled();
  });

  it('hides the Enter Kiosk Mode button on narrow/mobile viewports (< 1024px)', async () => {
    const originalInnerWidth = globalThis.innerWidth;
    globalThis.innerWidth = 768;

    const onEnterKiosk = vi.fn();
    render(<DisplayPage isKiosk={false} onEnterKiosk={onEnterKiosk} />);

    await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Enter Kiosk Mode' })).not.toBeInTheDocument();

    globalThis.innerWidth = originalInnerWidth;
  });

  it('updates Enter Kiosk Mode button visibility when window is resized', async () => {
    const originalInnerWidth = globalThis.innerWidth;
    globalThis.innerWidth = 1200;

    const onEnterKiosk = vi.fn();
    render(<DisplayPage isKiosk={false} onEnterKiosk={onEnterKiosk} />);

    await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Enter Kiosk Mode' })).toBeInTheDocument();

    act(() => {
      globalThis.innerWidth = 500;
      globalThis.dispatchEvent(new Event('resize'));
    });

    expect(screen.queryByRole('button', { name: 'Enter Kiosk Mode' })).not.toBeInTheDocument();

    act(() => {
      globalThis.innerWidth = 1280;
      globalThis.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByRole('button', { name: 'Enter Kiosk Mode' })).toBeInTheDocument();

    globalThis.innerWidth = originalInnerWidth;
  });

  it('cleans up rotation timer on unmount', async () => {
    const { unmount } = render(<DisplayPage isKiosk={false} />);
    await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
    unmount();
    expect(globalThis.clearInterval).toHaveBeenCalled();
  });

  it('displays an error message when the API fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure')) as any;

    render(<DisplayPage />);

    await waitFor(() => expect(screen.getByText('Network failure')).toBeInTheDocument());
  });

  it('displays a generic error if the response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    }) as any;

    render(<DisplayPage />);

    await waitFor(() => expect(screen.getByText('Unable to load wishes.')).toBeInTheDocument());
  });

  it('calculates dynamic limit using ResizeObserver bounds when in Kiosk Mode', async () => {
    // We mock the clientWidth and clientHeight to force a specific calculation
    // gap: 24, cardWidth: 240, cardHeight: 144
    // width: 800 -> cols: floor(824/264) = 3
    // height: 600 -> rows: floor((600+24-10)/168) = 3
    // capacity = 9

    const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis.window, 'innerWidth');

    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(globalThis.window, 'innerWidth', { configurable: true, value: 1200 });

    let observerCallback: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observerCallback = callback;
        }
        observe() {
          /* noop */
        }
        disconnect() {
          /* noop */
        }
      }
    );

    render(<DisplayPage isKiosk={true} />);

    // Trigger the observer manually
    act(() => {
      if (observerCallback) observerCallback([], {} as ResizeObserver);
    });

    // We should expect a fetch with limit=9 due to the 3x3 grid
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/random?limit=9');
    });

    // Cleanup prototype overrides
    if (originalClientWidth)
      Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
    if (originalClientHeight)
      Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
    if (originalInnerWidth)
      Object.defineProperty(globalThis.window, 'innerWidth', originalInnerWidth);
  });

  it('flags a wish and removes it from the display list when confirmed', async () => {
    vi.spyOn(globalThis.window, 'confirm').mockReturnValue(true);
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (url === '/api/wishes/random?limit=12') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'wish-1', content: 'Flag me' }],
        });
      }
      if (url === '/api/wishes/wish-1/flag' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    render(<DisplayPage isKiosk={false} />);

    // Wait for the wish to be displayed
    await waitFor(() => expect(screen.getByText('Flag me')).toBeInTheDocument());

    // Click flag button
    const flagBtn = screen.getByTitle('Flag as inappropriate');
    fireEvent.click(flagBtn);

    // Verify confirm was called
    expect(globalThis.window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to flag this wish as inappropriate?'
    );

    // Verify fetch flag endpoint was called
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wishes/wish-1/flag', { method: 'POST' });

    // Verify the wish was removed from the UI
    await waitFor(() => expect(screen.queryByText('Flag me')).not.toBeInTheDocument());
  });

  it('does not flag a wish if confirmation is cancelled', async () => {
    vi.spyOn(globalThis.window, 'confirm').mockReturnValue(false);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'wish-1',
          content: 'Cancel flag wish',
        },
      ],
    }) as any;

    render(<DisplayPage isKiosk={false} />);

    await waitFor(() => expect(screen.getByText('Cancel flag wish')).toBeInTheDocument());

    const flagBtn = screen.getByTitle('Flag as inappropriate');
    fireEvent.click(flagBtn);

    expect(globalThis.window.confirm).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only the initial load fetch
    expect(screen.getByText('Cancel flag wish')).toBeInTheDocument();
  });

  it('handles flagging failure by showing an alert', async () => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;

    vi.spyOn(globalThis.window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(globalThis.window, 'alert').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/wishes/random?limit=12') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'wish-1',
              content: 'Fail flag wish',
            },
          ],
        });
      }
      return Promise.resolve({ ok: false }); // fails flag POST
    }) as any;

    render(<DisplayPage isKiosk={false} />);

    await waitFor(() => expect(screen.getByText('Fail flag wish')).toBeInTheDocument());

    const flagBtn = screen.getByTitle('Flag as inappropriate');
    fireEvent.click(flagBtn);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to flag the wish.'));
    expect(screen.getByText('Fail flag wish')).toBeInTheDocument();
  });

  describe('kiosk mode split layout and title banner', () => {
    it('renders split layout with header banner and sidebar in kiosk mode', async () => {
      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wishboard');
      expect(screen.getByText('Live Community Board')).toBeInTheDocument();
      expect(screen.getByText(/Live • Auto-rotating/)).toBeInTheDocument();

      expect(screen.getByLabelText('Kiosk Onboarding Panel')).toBeInTheDocument();
      expect(screen.getByText('Join the Board')).toBeInTheDocument();
      expect(screen.getByText('Scan Wi-Fi QR Code')).toBeInTheDocument();

      expect(screen.queryByText('Enter Kiosk Mode')).not.toBeInTheDocument();
    });

    it('renders custom profile title in the header banner when provided', async () => {
      render(<DisplayPage isKiosk={true} title="Anthrocon 2026 Wishboard" />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Anthrocon 2026 Wishboard'
      );
    });

    it('renders profile title from EventProfileContext in header banner', async () => {
      const mockProfile = {
        profile: 'default',
        title: 'Spring Festival Wishboard',
        contact_methods: ['Phone'],
        categories: [],
        realtimeProvider: 'socketio',
        apIp: '',
        isServerless: false,
      };
      vi.mocked(useEventProfile).mockReturnValue(mockProfile as any);

      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Spring Festival Wishboard'
      );
    });

    it('renders capitalized profile wishboard title when only profile.profile is set', async () => {
      const mockProfile = {
        profile: 'anthro',
        contact_methods: ['Phone'],
        categories: [],
        realtimeProvider: 'socketio',
        apIp: '',
        isServerless: false,
      };
      vi.mocked(useEventProfile).mockReturnValue(mockProfile as any);

      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Anthro Wishboard');
    });

    it('renders error message in kiosk mode when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
      }) as any;

      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Unable to load wishes.')).toBeInTheDocument());
    });

    it('calculates capacity on large screens (innerWidth >= 1600)', async () => {
      const originalInnerWidth = globalThis.innerWidth;
      globalThis.innerWidth = 1920;

      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
      globalThis.innerWidth = originalInnerWidth;
    });

    it('toggles sidebar visibility and layout class when toggle button is clicked', async () => {
      render(<DisplayPage isKiosk={true} />);

      await waitFor(() => expect(screen.getByText('Big screen wish')).toBeInTheDocument());
      expect(screen.getByLabelText('Kiosk Onboarding Panel')).toBeInTheDocument();

      const toggleBtn = screen.getByRole('button', { name: 'Hide Sidebar' });
      fireEvent.click(toggleBtn);

      expect(screen.queryByLabelText('Kiosk Onboarding Panel')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show Sidebar' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show Sidebar' }));
      expect(screen.getByLabelText('Kiosk Onboarding Panel')).toBeInTheDocument();
    });
  });
});

/// <reference types="vite/client" />
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import WiFiQrCode from './WiFiQrCode';

const setConfig = (cfg: Record<string, unknown> | undefined) => {
  (globalThis as Record<string, unknown>).__WISHBOARD_CONFIG__ = cfg;
};

describe('WiFiQrCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setConfig(undefined);
  });

  afterEach(() => {
    // Tell React: "Hey, I'm about to do something that will trigger state changes"
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    setConfig(undefined);
    delete (import.meta.env as Record<string, unknown>).VITE_WISHBOARD_DOMAIN;
    delete (import.meta.env as Record<string, unknown>).VITE_WISHBOARD_AP_IP;
  });

  const showPopup = () => {
    render(<WiFiQrCode />);
    // Initial wait is 10000ms
    act(() => {
      vi.advanceTimersByTime(10000);
    });
  };

  it('initializes invisibly and waits for the initial delay', () => {
    const { container } = render(<WiFiQrCode />);
    expect(container.firstChild).toBeNull();
  });

  it('becomes visible after the initial delay', () => {
    showPopup();
    expect(screen.getByText('Connect to Wishboard')).toBeInTheDocument();
    expect(screen.getByText(/Wishboard_WiFi/)).toBeInTheDocument();
  });

  it('hides itself after the display duration', () => {
    showPopup();
    expect(screen.getByText('Connect to Wishboard')).toBeInTheDocument();

    // Hide duration is 30000ms
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    // Should be unmounted/invisible
    expect(screen.queryByText('Connect to Wishboard')).not.toBeInTheDocument();
  });

  it('displays the network credentials and the local AP IP (http) with no config', () => {
    showPopup();
    expect(screen.getByText(new RegExp(['wishboard', '2026'].join(''), 'i'))).toBeInTheDocument();
    // No server config and no build-time env → local AP IP over http.
    expect(screen.getByText('http://10.42.0.1:3000')).toBeInTheDocument();
  });

  it('prefers the server-configured public domain over the build-time env (https)', () => {
    // The #197 fix: the runtime domain wins over anything baked in at build time.
    setConfig({ domain: 'demo.wishboards.app' });
    (import.meta.env as Record<string, unknown>).VITE_WISHBOARD_DOMAIN = 'stale.example.com';

    showPopup();

    expect(screen.getByText('https://demo.wishboards.app')).toBeInTheDocument();
  });

  it('uses the build-time domain over https when there is no server config', () => {
    (import.meta.env as Record<string, unknown>).VITE_WISHBOARD_DOMAIN =
      'wishboard.painless-computing.com';

    showPopup();

    expect(screen.getByText('https://wishboard.painless-computing.com')).toBeInTheDocument();
  });

  it('falls back to the server-provided AP IP over http when no public domain is set', () => {
    setConfig({ apIp: '192.168.4.1:3000' });

    showPopup();

    expect(screen.getByText('http://192.168.4.1:3000')).toBeInTheDocument();
  });

  describe('sidebar variant', () => {
    it('is permanently visible immediately without waiting for timers', () => {
      render(<WiFiQrCode variant="sidebar" />);

      expect(screen.getByText('Join the Board')).toBeInTheDocument();
      expect(screen.getByText('Private Wishboard Wi-Fi')).toBeInTheDocument();
      expect(screen.getByText('Scan with Camera to Connect')).toBeInTheDocument();
      expect(screen.getByText('Scan Wi-Fi QR Code')).toBeInTheDocument();
      expect(screen.getByText('Open Portal')).toBeInTheDocument();
      expect(screen.getByText('Share Your Wish')).toBeInTheDocument();
      expect(screen.getByText('Wishboard_WiFi')).toBeInTheDocument();
      expect(screen.getByText(/Post a wish with your preferences/i)).toBeInTheDocument();
      expect(screen.getByText(/Browse for compatible wishes to grant/i)).toBeInTheDocument();

      // Advancing timer does NOT hide it
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(screen.getByText('Join the Board')).toBeInTheDocument();
    });

    it('renders public domain URL in sidebar', () => {
      setConfig({ domain: 'kiosk.wishboard.org' });
      render(<WiFiQrCode variant="sidebar" />);

      expect(screen.getByText('https://kiosk.wishboard.org')).toBeInTheDocument();
    });
  });
});

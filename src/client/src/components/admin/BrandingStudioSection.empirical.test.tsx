import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { useTheme } from '../../hooks/useTheme';
import { getSocket } from '../../hooks/useWebSocket';
import BrandingStudioSection from './BrandingStudioSection';
import { extractUrl } from '../../../../../tests/testUtils';

// Mock AuthContext and EventProfileContext for useTheme
const useAuthMock = vi.fn();
const useEventProfileMock = vi.fn();

vi.mock('../../AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../EventProfileContext', () => ({
  useEventProfile: () => useEventProfileMock(),
}));

const MOCK_INITIAL_BRANDING = {
  themePreset: 'midnight',
  primaryColor: '#f59e0b',
  accentColor: '#fbbf24',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Solar Expo 2026',
  tagline: 'Connect and innovate',
  boardTexture: 'cork',
  logoUrl: '/images/logo-test.png',
  boardBgUrl: null,
};

const MOCK_DEFAULT_RESET_BRANDING = {
  themePreset: 'midnight',
  primaryColor: '#f59e0b',
  accentColor: '#fbbf24',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Wishboard',
  tagline: 'Pin your convention wishes',
  boardTexture: 'cork',
  logoUrl: null,
  boardBgUrl: null,
};

describe('Empirical Verification: Theming and Branding Studio', () => {
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
      branding: MOCK_INITIAL_BRANDING,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.localStorage.clear();
  });

  describe('Scenario 1: Attendee Theme Isolation under sys:branding broadcast', () => {
    it('strictly maintains "high-contrast" mode when host broadcasts daylight theme with custom colors', async () => {
      // Simulate attendee with explicit high-contrast theme
      useAuthMock.mockReturnValue({
        user: {
          id: 'user-hc',
          username: 'hc_user',
          ui_preferences: { themeMode: 'high-contrast' },
        },
        token: 'token-hc',
        refreshUser: vi.fn(),
      });

      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      // Prior to broadcast, attendee has high-contrast
      expect(result.current.themeMode).toBe('high-contrast');
      expect(result.current.effectiveTheme).toBe('high-contrast');
      expect(document.documentElement.dataset.theme).toBe('high-contrast');

      // Find the registered sys:branding listener
      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];
      expect(brandingListener).toBeDefined();

      // Host broadcasts a major theme change: daylight preset with custom primary/accent/surface and new logo/bg
      act(() => {
        brandingListener({
          themePreset: 'daylight',
          primaryColor: '#2563eb',
          accentColor: '#1d4ed8',
          surfaceColor: '#ffffff',
          boardTitle: 'Solar Fest Live',
          tagline: 'Bright ideas',
          boardTexture: 'custom',
          logoUrl: '/images/broadcast-logo.png',
          boardBgUrl: '/images/broadcast-bg.webp',
        });
      });

      // 1. Theme mode MUST remain high-contrast
      expect(result.current.effectiveTheme).toBe('high-contrast');
      expect(document.documentElement.dataset.theme).toBe('high-contrast');

      // 2. Custom host colors MUST NOT override high-contrast CSS tokens (inline styles removed)
      expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-accent-hover')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-bg-surface')).toBe('');

      // 3. Brand assets (title, logo, texture, background) MUST update seamlessly
      expect(result.current.branding.boardTitle).toBe('Solar Fest Live');
      expect(result.current.branding.tagline).toBe('Bright ideas');
      expect(document.documentElement.dataset.boardTexture).toBe('custom');
      expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe(
        "url('/images/broadcast-logo.png')"
      );
      expect(document.documentElement.style.getPropertyValue('--wb-board-bg-url')).toBe(
        "url('/images/broadcast-bg.webp')"
      );
      expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
        "url('/images/broadcast-bg.webp')"
      );
    });

    it('strictly maintains "corkhouse" mode when host broadcasts high-contrast preset', async () => {
      useAuthMock.mockReturnValue({
        user: {
          id: 'user-cork',
          username: 'cork_user',
          ui_preferences: { themeMode: 'corkhouse' },
        },
        token: 'token-cork',
        refreshUser: vi.fn(),
      });

      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      expect(result.current.effectiveTheme).toBe('corkhouse');
      expect(document.documentElement.dataset.theme).toBe('corkhouse');

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      act(() => {
        brandingListener({
          themePreset: 'high-contrast',
          primaryColor: '#ffff00',
          accentColor: '#ffffff',
          surfaceColor: '#000000',
          boardTitle: 'Accessibility Expo',
          logoUrl: '/images/a11y.png',
          boardTexture: 'slate',
        });
      });

      // Attendee personal theme is preserved as corkhouse
      expect(result.current.effectiveTheme).toBe('corkhouse');
      expect(document.documentElement.dataset.theme).toBe('corkhouse');

      // Accent overrides are cleared so corkhouse's CSS palette applies
      expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-accent-hover')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-bg-surface')).toBe('');

      // Brand title, texture, and logo reflect host updates
      expect(result.current.branding.boardTitle).toBe('Accessibility Expo');
      expect(document.documentElement.dataset.boardTexture).toBe('slate');
      expect(document.documentElement.style.getPropertyValue('--wb-board-texture')).toBe(
        "url('/textures/slate.webp')"
      );
    });

    it('unsets accent-primary and accent-hover when branding colors are empty strings or null in host-default mode', () => {
      const { result } = renderHook(() => useTheme());
      const socket = getSocket();

      const brandingListener = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'sys:branding')?.[1];

      act(() => {
        brandingListener({
          themePreset: 'midnight',
          primaryColor: '',
          accentColor: '',
          surfaceColor: '',
          logoUrl: null,
          boardBgUrl: null,
          boardTexture: 'cork',
        });
      });

      expect(result.current.effectiveTheme).toBe('midnight');
      expect(document.documentElement.style.getPropertyValue('--wb-accent-primary')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-accent-hover')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-bg-surface')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-brand-logo-url')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--wb-board-bg-url')).toBe('');
    });
  });

  describe('Scenario 2: Reset Safety and Form State Preservation', () => {
    it('cancelling confirmation strictly aborts DELETE request and preserves unsaved user modifications', async () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_INITIAL_BRANDING,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
      globalThis.fetch = fetchSpy;

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByLabelText(/board title/i)).toBeInTheDocument();
      });

      const titleInput = screen.getByLabelText(/board title/i) as HTMLInputElement;
      const taglineInput = screen.getByLabelText(/tagline \/ subtitle/i) as HTMLInputElement;
      const primaryHexInput = screen.getByLabelText(/primary brand color hex/i) as HTMLInputElement;

      expect(titleInput.value).toBe('Solar Expo 2026');

      // User makes unsaved edits
      fireEvent.change(titleInput, { target: { value: 'Draft Custom Title' } });
      fireEvent.change(taglineInput, { target: { value: 'Draft Custom Tagline' } });
      fireEvent.change(primaryHexInput, { target: { value: '#123456' } });

      expect(titleInput.value).toBe('Draft Custom Title');
      expect(taglineInput.value).toBe('Draft Custom Tagline');
      expect(primaryHexInput.value).toBe('#123456');

      // Click Reset to Defaults
      const resetBtn = screen.getByRole('button', { name: /reset to defaults/i });
      await act(async () => {
        fireEvent.click(resetBtn);
      });

      // Confirm dialog was presented
      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to reset all branding settings to event profile defaults?'
      );

      // Verify DELETE was NOT called
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/branding'),
        expect.objectContaining({ method: 'DELETE' })
      );

      // Unsaved form inputs MUST remain unchanged
      expect(titleInput.value).toBe('Draft Custom Title');
      expect(taglineInput.value).toBe('Draft Custom Tagline');
      expect(primaryHexInput.value).toBe('#123456');

      // Confirm dialog accepted on second attempt
      confirmSpy.mockReturnValue(true);
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            return {
              ok: true,
              status: 200,
              json: async () => ({ success: true, branding: MOCK_DEFAULT_RESET_BRANDING }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      await act(async () => {
        fireEvent.click(resetBtn);
      });

      // Now DELETE must have been dispatched
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/branding'),
        expect.objectContaining({ method: 'DELETE' })
      );

      // Form is now reset to profile defaults
      await waitFor(() => {
        expect(titleInput.value).toBe('Wishboard');
        expect(taglineInput.value).toBe('Pin your convention wishes');
        expect(setMessageMock).toHaveBeenCalledWith(
          'Branding configuration reset to profile defaults.'
        );
      });
    });

    it('falls back to DEFAULT_BRANDING if DELETE returns success without branding object', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            return {
              ok: true,
              status: 200,
              json: async () => ({ success: true }), // branding omitted
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
      });

      await waitFor(() => {
        expect(setMessageMock).toHaveBeenCalledWith(
          'Branding configuration reset to profile defaults.'
        );
      });
      expect(screen.getByLabelText(/board title/i)).toHaveValue('Wishboard');
    });
  });

  describe('Scenario 3: Error Handling & Resilience', () => {
    it('displays error banner when initial GET encounters network rejection', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith('Unable to load branding configuration.');
      });
    });

    it('displays error banner when PUT encounters network rejection', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'PUT') {
            throw new Error('Save network drop');
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^save branding$/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^save branding$/i }));
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith(
          'An unexpected error occurred while saving branding.'
        );
      });
    });

    it('displays error banner when PUT returns error message from server', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'PUT') {
            return {
              ok: false,
              status: 400,
              json: async () => ({ success: false, error: 'Invalid hex color value' }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^save branding$/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^save branding$/i }));
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith('Invalid hex color value');
      });
    });

    it('displays error banner when DELETE returns error message from server', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            return {
              ok: false,
              status: 400,
              json: async () => ({ success: false, error: 'Database locked' }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith('Database locked');
      });
    });

    it('displays error banner when DELETE encounters network rejection', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            throw new Error('Network offline');
          }
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith(
          'An unexpected error occurred while resetting branding.'
        );
      });
    });

    it('handles image upload server error response', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding/upload')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ success: false, error: 'File magic bytes mismatch' }),
          } as Response;
        }
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      const pngFile = new File(['corrupt-png'], 'test.png', { type: 'image/png' });

      await act(async () => {
        fireEvent.change(screen.getByTestId('branding-logo-upload-input'), {
          target: { files: [pngFile] },
        });
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith('File magic bytes mismatch');
      });
    });

    it('handles image upload network rejection gracefully', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding/upload')) {
          throw new Error('Upload pipe broken');
        }
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => MOCK_INITIAL_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      const pngFile = new File(['png-data'], 'valid.png', { type: 'image/png' });

      await act(async () => {
        fireEvent.change(screen.getByTestId('branding-logo-upload-input'), {
          target: { files: [pngFile] },
        });
      });

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith(
          'An unexpected error occurred during image upload.'
        );
      });
    });

    it('supports keyboard navigation (Enter and Space) on dropzone and leaves drop on non-file drag', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...MOCK_INITIAL_BRANDING, logoUrl: null }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByLabelText(/upload organization logo/i)).toBeInTheDocument()
      );

      const dropzone = screen.getByLabelText(/upload organization logo/i);

      // Trigger drag over and drag leave
      fireEvent.dragOver(dropzone);
      fireEvent.dragLeave(dropzone);

      // Trigger drop with empty dataTransfer
      fireEvent.drop(dropzone, { dataTransfer: { files: [] } });

      // Trigger keyboard events
      fireEvent.keyDown(dropzone, { key: 'Enter' });
      fireEvent.keyDown(dropzone, { key: ' ' });
      fireEvent.keyDown(dropzone, { key: 'Tab' }); // ignored key

      // Render star icon when logoUrl is null
      expect(screen.getByText('🌟')).toBeInTheDocument();
    });

    it('handles non-hex colors in primary and accent inputs by falling back in color picker', async () => {
      const setMessageMock = vi.fn();
      const setErrorMock = vi.fn();

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...MOCK_INITIAL_BRANDING,
              primaryColor: 'rgb(245, 158, 11)',
              accentColor: 'rgb(251, 191, 36)',
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer test-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByLabelText(/primary brand color picker/i)).toBeInTheDocument()
      );

      // Falls back to #f59e0b and #fbbf24 for picker value when not starting with '#'
      expect(screen.getByLabelText(/primary brand color picker/i)).toHaveValue('#f59e0b');
      expect(screen.getByLabelText(/accent highlight color picker/i)).toHaveValue('#fbbf24');
    });
  });
});

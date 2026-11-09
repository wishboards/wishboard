import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import BrandingStudioSection, { validateRasterFile } from './BrandingStudioSection';
import { extractUrl } from '../../../../../tests/testUtils';

const MOCK_BRANDING = {
  themePreset: 'midnight',
  primaryColor: '#f59e0b',
  accentColor: '#fbbf24',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Solar Expo 2026',
  tagline: 'Connect and innovate',
  boardTexture: 'cork',
  logoUrl: '/images/logo-test.png',
  boardBgUrl: '/images/bg-test.webp',
};

const DEFAULT_RESET_BRANDING = {
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

describe('BrandingStudioSection', () => {
  const setMessageMock = vi.fn();
  const setErrorMock = vi.fn();
  const onSessionExpiredMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateRasterFile helper', () => {
    it('rejects SVG files by MIME type and filename', () => {
      const svgMimeFile = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
      expect(validateRasterFile(svgMimeFile)).toContain('Only PNG, JPG, and WEBP');

      const svgExtFile = new File(['dummy'], 'graphic.svg', { type: 'application/octet-stream' });
      expect(validateRasterFile(svgExtFile)).toContain('Only PNG, JPG, and WEBP');
    });

    it('rejects non-raster formats (PDF, text, HTML)', () => {
      const pdfFile = new File(['%PDF'], 'document.pdf', { type: 'application/pdf' });
      expect(validateRasterFile(pdfFile)).toContain('Only PNG, JPG, and WEBP');

      const htmlFile = new File(['<h1>hi</h1>'], 'page.html', { type: 'text/html' });
      expect(validateRasterFile(htmlFile)).toContain('Only PNG, JPG, and WEBP');
    });

    it('rejects files larger than 5MB', () => {
      const bigFile = new File(['x'], 'large.png', { type: 'image/png' });
      Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });
      expect(validateRasterFile(bigFile)).toBe('File size exceeds the 5MB limit.');
    });

    it('accepts valid raster image formats (PNG, JPEG, WebP)', () => {
      const pngFile = new File(['png-data'], 'photo.png', { type: 'image/png' });
      expect(validateRasterFile(pngFile)).toBeNull();

      const jpgFile = new File(['jpeg-data'], 'photo.jpg', { type: 'image/jpeg' });
      expect(validateRasterFile(jpgFile)).toBeNull();

      const webpFile = new File(['webp-data'], 'photo.webp', { type: 'image/webp' });
      expect(validateRasterFile(webpFile)).toBeNull();
    });
  });

  describe('Component Rendering and Initial Fetch', () => {
    it('loads and populates initial branding data into form fields', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      expect(screen.getByText(/loading branding studio.../i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByLabelText(/theme preset/i)).toBeInTheDocument();
      });

      const titleInput = screen.getByLabelText(/board title/i) as HTMLInputElement;
      expect(titleInput.value).toBe('Solar Expo 2026');

      const taglineInput = screen.getByLabelText(/tagline \/ subtitle/i) as HTMLInputElement;
      expect(taglineInput.value).toBe('Connect and innovate');

      const presetSelect = screen.getByLabelText(/theme preset/i) as HTMLSelectElement;
      expect(presetSelect.value).toBe('midnight');

      const textureSelect = screen.getByLabelText(/board texture/i) as HTMLSelectElement;
      expect(textureSelect.value).toBe('cork');

      const surfaceInput = screen.getByLabelText(/surface tint/i) as HTMLInputElement;
      expect(surfaceInput.value).toBe('rgba(30, 41, 59, 0.78)');

      expect(screen.getByAltText(/organization logo preview/i)).toHaveAttribute(
        'src',
        '/images/logo-test.png'
      );
      expect(screen.getByAltText(/board background image preview/i)).toHaveAttribute(
        'src',
        '/images/bg-test.webp'
      );
    });

    it('triggers onSessionExpired if GET /api/admin/branding returns 401', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized' }),
          }) as Response
      );

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer invalid-token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      await waitFor(() => {
        expect(onSessionExpiredMock).toHaveBeenCalled();
      });
    });

    it('sets error message if GET /api/admin/branding fails with 500', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Server Error' }),
          }) as Response
      );

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      await waitFor(() => {
        expect(setErrorMock).toHaveBeenCalledWith('Failed to load branding configuration.');
      });
    });
  });

  describe('Form Field Editing and Preset Changes', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
    });

    it('updates text inputs and texture select', async () => {
      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/board title/i)).toBeInTheDocument());

      const titleInput = screen.getByLabelText(/board title/i);
      fireEvent.change(titleInput, { target: { value: 'Updated Convention Title' } });
      expect(titleInput).toHaveValue('Updated Convention Title');

      const taglineInput = screen.getByLabelText(/tagline \/ subtitle/i);
      fireEvent.change(taglineInput, { target: { value: 'New Amazing Subtitle' } });
      expect(taglineInput).toHaveValue('New Amazing Subtitle');

      const textureSelect = screen.getByLabelText(/board texture/i);
      fireEvent.change(textureSelect, { target: { value: 'linen' } });
      expect(textureSelect).toHaveValue('linen');
    });

    it('adapts colors when switching presets (daylight, corkhouse, high-contrast, custom)', async () => {
      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/theme preset/i)).toBeInTheDocument());

      const presetSelect = screen.getByLabelText(/theme preset/i);

      // Switch to daylight
      fireEvent.change(presetSelect, { target: { value: 'daylight' } });
      expect(presetSelect).toHaveValue('daylight');
      expect(screen.getByLabelText(/surface tint/i)).toHaveValue('#ffffff');

      // Switch to corkhouse
      fireEvent.change(presetSelect, { target: { value: 'corkhouse' } });
      expect(presetSelect).toHaveValue('corkhouse');
      expect(screen.getByLabelText(/surface tint/i)).toHaveValue('rgba(58, 43, 31, 0.88)');

      // Switch to high-contrast
      fireEvent.change(presetSelect, { target: { value: 'high-contrast' } });
      expect(presetSelect).toHaveValue('high-contrast');
      expect(screen.getByLabelText(/surface tint/i)).toHaveValue('#000000');

      // Switch to custom
      fireEvent.change(presetSelect, { target: { value: 'custom' } });
      expect(presetSelect).toHaveValue('custom');
    });

    it('allows editing colors via color picker and text inputs', async () => {
      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByLabelText(/primary brand color picker/i)).toBeInTheDocument()
      );

      const primaryHexInput = screen.getByLabelText(/primary brand color hex/i);
      fireEvent.change(primaryHexInput, { target: { value: '#10b981' } });
      expect(primaryHexInput).toHaveValue('#10b981');

      const accentHexInput = screen.getByLabelText(/accent highlight color hex/i);
      fireEvent.change(accentHexInput, { target: { value: '#059669' } });
      expect(accentHexInput).toHaveValue('#059669');

      const surfaceInput = screen.getByLabelText(/surface tint/i);
      fireEvent.change(surfaceInput, { target: { value: 'rgba(10, 20, 30, 0.9)' } });
      expect(surfaceInput).toHaveValue('rgba(10, 20, 30, 0.9)');
    });
  });

  describe('Raster-Only File Uploads & Dropzone Validation', () => {
    it('immediately rejects SVG file without making API call', async () => {
      const fetchSpy = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          }) as Response
      );
      globalThis.fetch = fetchSpy;

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      // Attempt SVG file input
      const svgFile = new File(['<svg></svg>'], 'malicious.svg', { type: 'image/svg+xml' });
      const logoInput = screen.getByTestId('branding-logo-upload-input');

      fireEvent.change(logoInput, { target: { files: [svgFile] } });

      expect(setErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Only PNG, JPG, and WEBP raster images are allowed')
      );
      // Ensure upload endpoint was NOT called
      expect(fetchSpy).not.toHaveBeenCalledWith('/api/admin/branding/upload', expect.anything());
    });

    it('rejects files exceeding 5MB limit', async () => {
      const fetchSpy = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          }) as Response
      );
      globalThis.fetch = fetchSpy;

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      const largeFile = new File(['big-png'], 'large.png', { type: 'image/png' });
      Object.defineProperty(largeFile, 'size', { value: 10 * 1024 * 1024 });
      const logoInput = screen.getByTestId('branding-logo-upload-input');

      fireEvent.change(logoInput, { target: { files: [largeFile] } });

      expect(setErrorMock).toHaveBeenCalledWith('File size exceeds the 5MB limit.');
      expect(fetchSpy).not.toHaveBeenCalledWith('/api/admin/branding/upload', expect.anything());
    });

    it('accepts PNG raster file and uploads via POST /api/admin/branding/upload', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding/upload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              url: '/images/uploaded-logo.png',
              filename: 'uploaded-logo.png',
            }),
          } as Response;
        }
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...MOCK_BRANDING, logoUrl: null }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      const pngFile = new File(['valid-png'], 'banner.png', { type: 'image/png' });
      const logoInput = screen.getByTestId('branding-logo-upload-input');

      await act(async () => {
        fireEvent.change(logoInput, { target: { files: [pngFile] } });
      });

      await waitFor(() => {
        expect(setMessageMock).toHaveBeenCalledWith('Logo uploaded successfully.');
      });
      expect(screen.getByAltText(/organization logo preview/i)).toHaveAttribute(
        'src',
        '/images/uploaded-logo.png'
      );
    });

    it('accepts WebP raster file via drag and drop for background', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding/upload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              url: '/images/uploaded-bg.webp',
              filename: 'uploaded-bg.webp',
            }),
          } as Response;
        }
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...MOCK_BRANDING, boardBgUrl: null }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByLabelText(/upload board background image/i)).toBeInTheDocument()
      );

      const dropzone = screen.getByLabelText(/upload board background image/i);
      const webpFile = new File(['valid-webp'], 'texture.webp', { type: 'image/webp' });

      fireEvent.dragOver(dropzone);
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [webpFile] } });
      });

      await waitFor(() => {
        expect(setMessageMock).toHaveBeenCalledWith('Background image uploaded successfully.');
      });
      expect(screen.getByAltText(/board background image preview/i)).toHaveAttribute(
        'src',
        '/images/uploaded-bg.webp'
      );
    });

    it('can remove uploaded logo and background', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /remove organization logo/i })
        ).toBeInTheDocument()
      );

      const removeLogoBtn = screen.getByRole('button', { name: /remove organization logo/i });
      fireEvent.click(removeLogoBtn);

      expect(screen.queryByAltText(/organization logo preview/i)).not.toBeInTheDocument();

      const removeBgBtn = screen.getByRole('button', { name: /remove board background image/i });
      fireEvent.click(removeBgBtn);

      expect(screen.queryByAltText(/board background image preview/i)).not.toBeInTheDocument();
    });

    it('handles 401 session expiration during upload', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding/upload')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...MOCK_BRANDING, logoUrl: null }),
        } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId('branding-logo-upload-input')).toBeInTheDocument()
      );

      const pngFile = new File(['png-data'], 'test.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.change(screen.getByTestId('branding-logo-upload-input'), {
          target: { files: [pngFile] },
        });
      });

      await waitFor(() => {
        expect(onSessionExpiredMock).toHaveBeenCalled();
      });
    });
  });

  describe('Saving and Resetting Branding', () => {
    it('saves branding configuration via PUT /api/admin/branding', async () => {
      let savedBody: any = null;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'PUT') {
            savedBody = JSON.parse(init.body as string);
            return {
              ok: true,
              status: 200,
              json: async () => ({ success: true, branding: savedBody }),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_BRANDING,
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/board title/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/board title/i), {
        target: { value: 'Comicon Tokyo' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^save branding$/i }));
      });

      await waitFor(() => {
        expect(setMessageMock).toHaveBeenCalledWith('Branding configuration saved successfully.');
      });
      expect(savedBody.boardTitle).toBe('Comicon Tokyo');
    });

    it('handles 401 when saving branding', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'PUT') {
            return {
              ok: false,
              status: 401,
              json: async () => ({ error: 'Unauthorized' }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^save branding$/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^save branding$/i }));
      });

      await waitFor(() => {
        expect(onSessionExpiredMock).toHaveBeenCalled();
      });
    });

    it('resets branding to profile defaults via DELETE /api/admin/branding upon confirmation', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

      let deleteCalled = false;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            deleteCalled = true;
            return {
              ok: true,
              status: 200,
              json: async () => ({ success: true, branding: DEFAULT_RESET_BRANDING }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
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
      expect(deleteCalled).toBe(true);
      expect(screen.getByLabelText(/board title/i)).toHaveValue('Wishboard');
    });

    it('aborts reset if user cancels confirmation dialog', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => MOCK_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });
      globalThis.fetch = fetchSpy;

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
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

      // DELETE should NOT have been called
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/branding'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('handles 401 when resetting branding', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'DELETE') {
            return {
              ok: false,
              status: 401,
              json: async () => ({ error: 'Unauthorized' }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => MOCK_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
          onSessionExpired={onSessionExpiredMock}
        />
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
      });

      await waitFor(() => {
        expect(onSessionExpiredMock).toHaveBeenCalled();
      });
    });
  });
});

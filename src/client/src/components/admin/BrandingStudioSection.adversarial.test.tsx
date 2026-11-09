import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import BrandingStudioSection, { validateRasterFile } from './BrandingStudioSection';
import { extractUrl } from '../../../../../tests/testUtils';

const BASE_MOCK_BRANDING = {
  themePreset: 'midnight',
  primaryColor: '#f59e0b',
  accentColor: '#fbbf24',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Convention Alpha',
  tagline: 'Connect and innovate',
  boardTexture: 'cork',
  logoUrl: null,
  boardBgUrl: null,
};

describe('BrandingStudioSection — Adversarial & Stress Testing', () => {
  const setMessageMock = vi.fn();
  const setErrorMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Adversarial File Upload & Boundary Validation', () => {
    it('rejects .svg files with image/svg+xml MIME type', () => {
      const file = new File(['<svg></svg>'], 'vector.svg', { type: 'image/svg+xml' });
      expect(validateRasterFile(file)).toContain('Only PNG, JPG, and WEBP');
    });

    it('rejects uppercase .SVG files with image/svg+xml MIME type', () => {
      const file = new File(['<svg></svg>'], 'VECTOR.SVG', { type: 'image/svg+xml' });
      expect(validateRasterFile(file)).toContain('Only PNG, JPG, and WEBP');
    });

    it('rejects mixed-case .SvG files even with generic octet-stream MIME', () => {
      const file = new File(['<svg></svg>'], 'vector.SvG', { type: 'application/octet-stream' });
      expect(validateRasterFile(file)).toContain('Only PNG, JPG, and WEBP');
    });

    it('rejects spoofed double-extension .svg.png when MIME is image/svg+xml', () => {
      const file = new File(['<svg></svg>'], 'photo.svg.png', { type: 'image/svg+xml' });
      expect(validateRasterFile(file)).toContain('Only PNG, JPG, and WEBP');
    });

    it('accepts double-extension .svg.png when genuine raster image/png MIME', () => {
      const file = new File(['fake-png-binary'], 'chart.svg.png', { type: 'image/png' });
      expect(validateRasterFile(file)).toBeNull();
    });

    it('rejects extensionless files with empty MIME type', () => {
      const file = new File(['binary'], 'untypedfile', { type: '' });
      expect(validateRasterFile(file)).toContain('Only PNG, JPG, and WEBP');
    });

    it('accepts extensionless files if identified as valid raster MIME', () => {
      const file = new File(['png-data'], 'extensionless', { type: 'image/png' });
      expect(validateRasterFile(file)).toBeNull();
    });

    it('accepts uppercase raster extensions with matching raster MIME types', () => {
      const pngFile = new File(['png'], 'PHOTO.PNG', { type: 'image/png' });
      expect(validateRasterFile(pngFile)).toBeNull();

      const jpgFile = new File(['jpg'], 'PHOTO.JPEG', { type: 'image/jpeg' });
      expect(validateRasterFile(jpgFile)).toBeNull();

      const webpFile = new File(['webp'], 'GRAPHIC.WEBP', { type: 'image/webp' });
      expect(validateRasterFile(webpFile)).toBeNull();
    });

    it('enforces exact 5MB boundary condition: 5,242,880 bytes passes, 5,242,881 bytes fails', () => {
      const EXACT_5MB = 5 * 1024 * 1024; // 5,242,880 bytes
      const OVER_5MB = EXACT_5MB + 1; // 5,242,881 bytes

      const passFile = new File(['x'], 'exact-5mb.png', { type: 'image/png' });
      Object.defineProperty(passFile, 'size', { value: EXACT_5MB });
      expect(validateRasterFile(passFile)).toBeNull();

      const failFile = new File(['x'], 'over-5mb.png', { type: 'image/png' });
      Object.defineProperty(failFile, 'size', { value: OVER_5MB });
      expect(validateRasterFile(failFile)).toBe('File size exceeds the 5MB limit.');
    });

    it('accepts zero-byte raster image (valid size boundary)', () => {
      const zeroFile = new File([''], 'empty.png', { type: 'image/png' });
      Object.defineProperty(zeroFile, 'size', { value: 0 });
      expect(validateRasterFile(zeroFile)).toBeNull();
    });

    it('prevents network requests when dropping disallowed file in logo dropzone', async () => {
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => BASE_MOCK_BRANDING } as Response;
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
        expect(screen.getByLabelText(/upload organization logo/i)).toBeInTheDocument()
      );

      const dropzone = screen.getByLabelText(/upload organization logo/i);
      const svgFile = new File(['<svg onload="alert(1)"></svg>'], 'exploit.svg', {
        type: 'image/svg+xml',
      });

      fireEvent.dragOver(dropzone);
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [svgFile] } });
      });

      expect(setErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('SVGs are strictly prohibited')
      );
      // Ensure zero upload network calls dispatched
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/upload'),
        expect.anything()
      );
    });

    it('prevents network requests when selecting over-5MB file via input change', async () => {
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => BASE_MOCK_BRANDING } as Response;
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
        expect(screen.getByTestId('branding-bg-upload-input')).toBeInTheDocument()
      );

      const hugeFile = new File(['huge'], 'huge-backdrop.webp', { type: 'image/webp' });
      Object.defineProperty(hugeFile, 'size', { value: 5242881 });

      const bgInput = screen.getByTestId('branding-bg-upload-input');
      await act(async () => {
        fireEvent.change(bgInput, { target: { files: [hugeFile] } });
      });

      expect(setErrorMock).toHaveBeenCalledWith('File size exceeds the 5MB limit.');
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/upload'),
        expect.anything()
      );
    });
  });

  describe('Boundary & Corner Inputs (Empty, Whitespace, 500-chars, XSS)', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          return { ok: true, status: 200, json: async () => BASE_MOCK_BRANDING } as Response;
        }
        return { ok: false } as Response;
      });
    });

    it('handles empty board title and tagline, gracefully falling back in LivePreview', async () => {
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
      const taglineInput = screen.getByLabelText(/tagline \/ subtitle/i);

      fireEvent.change(titleInput, { target: { value: '' } });
      fireEvent.change(taglineInput, { target: { value: '' } });

      expect(titleInput).toHaveValue('');
      expect(taglineInput).toHaveValue('');

      // In LivePreview, fallback text is displayed
      const livePreview = screen.getByLabelText(/live branding preview/i);
      expect(livePreview).toHaveTextContent('Wishboard');
      expect(livePreview).toHaveTextContent('Pin your convention wishes');
    });

    it('handles whitespace-only title without throwing exceptions', async () => {
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
      fireEvent.change(titleInput, { target: { value: '   ' } });
      expect(titleInput).toHaveValue('   ');

      const livePreview = screen.getByLabelText(/live branding preview/i);
      expect(livePreview).toBeInTheDocument();
    });

    it('renders and dispatches 500-character titles and taglines without crashing', async () => {
      let putPayload: any = null;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = extractUrl(input);
        if (url.endsWith('/api/admin/branding')) {
          if (init?.method === 'PUT') {
            putPayload = JSON.parse(init.body as string);
            return {
              ok: true,
              status: 200,
              json: async () => ({ success: true, branding: putPayload }),
            } as Response;
          }
          return { ok: true, status: 200, json: async () => BASE_MOCK_BRANDING } as Response;
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

      const longTitle = 'T'.repeat(500);
      const longTagline = 'G'.repeat(500);

      fireEvent.change(screen.getByLabelText(/board title/i), { target: { value: longTitle } });
      fireEvent.change(screen.getByLabelText(/tagline \/ subtitle/i), {
        target: { value: longTagline },
      });

      const livePreview = screen.getByLabelText(/live branding preview/i);
      expect(livePreview).toHaveTextContent(longTitle);
      expect(livePreview).toHaveTextContent(longTagline);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^save branding$/i }));
      });

      await waitFor(() => {
        expect(setMessageMock).toHaveBeenCalledWith('Branding configuration saved successfully.');
      });
      expect(putPayload.boardTitle).toBe(longTitle);
      expect(putPayload.tagline).toBe(longTagline);
    });

    it('safely escapes HTML tags and script strings in title and tagline (XSS defense)', async () => {
      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/board title/i)).toBeInTheDocument());

      const xssTitle = '<script>window.pwned=true;</script><b>Convention</b>';
      const xssTagline = '<img src=x onerror="alert(1)">"><svg/onload=alert(2)>';

      fireEvent.change(screen.getByLabelText(/board title/i), { target: { value: xssTitle } });
      fireEvent.change(screen.getByLabelText(/tagline \/ subtitle/i), {
        target: { value: xssTagline },
      });

      const livePreview = screen.getByLabelText(/live branding preview/i);

      // Verify strings are rendered as plain text nodes, not executed or parsed into DOM nodes
      expect(livePreview.textContent).toContain(xssTitle);
      expect(livePreview.textContent).toContain(xssTagline);
      expect(livePreview.querySelector('script')).toBeNull();
      expect(livePreview.querySelector('img[src="x"]')).toBeNull();
      expect(livePreview.querySelector('svg[onload]')).toBeNull();
      expect((globalThis as any).pwned).toBeUndefined();
    });

    it('safely tolerates unusual and invalid color inputs (#xyz, out-of-range rgba, javascript:)', async () => {
      render(
        <BrandingStudioSection
          authHeader={{ Authorization: 'Bearer token-123' }}
          setMessage={setMessageMock}
          setError={setErrorMock}
          refreshCounter={0}
        />
      );

      await waitFor(() =>
        expect(screen.getByLabelText(/primary brand color hex/i)).toBeInTheDocument()
      );

      const primaryHexInput = screen.getByLabelText(/primary brand color hex/i);
      const accentHexInput = screen.getByLabelText(/accent highlight color hex/i);
      const surfaceInput = screen.getByLabelText(/surface tint/i);

      // Test unusual values
      fireEvent.change(primaryHexInput, { target: { value: '#xyz' } });
      fireEvent.change(accentHexInput, { target: { value: 'rgba(999,999,999,2)' } });
      fireEvent.change(surfaceInput, { target: { value: 'javascript:alert(1)' } });

      expect(primaryHexInput).toHaveValue('#xyz');
      expect(accentHexInput).toHaveValue('rgba(999,999,999,2)');
      expect(surfaceInput).toHaveValue('javascript:alert(1)');

      // LivePreview renders without throwing
      const livePreview = screen.getByLabelText(/live branding preview/i);
      expect(livePreview).toBeInTheDocument();
    });

    it('survives rapid cycle switching across all 5 theme presets without race conditions', async () => {
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
      const presets = ['daylight', 'corkhouse', 'high-contrast', 'custom', 'midnight'] as const;

      // Cycle rapidly through presets multiple times
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const preset of presets) {
          fireEvent.change(presetSelect, { target: { value: preset } });
          expect(presetSelect).toHaveValue(preset);
        }
      }

      // End on corkhouse and verify colors
      fireEvent.change(presetSelect, { target: { value: 'corkhouse' } });
      expect(screen.getByLabelText(/primary brand color hex/i)).toHaveValue('#d97706');
      expect(screen.getByLabelText(/accent highlight color hex/i)).toHaveValue('#b45309');
      expect(screen.getByLabelText(/surface tint/i)).toHaveValue('rgba(58, 43, 31, 0.88)');
    });
  });
});

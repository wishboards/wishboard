import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import EnterWishPage from './EnterWishPage';
import { flushPromises } from '../utils/testUtils';

import * as AuthContext from '../AuthContext';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(() => ({ token: null })),
}));

vi.mock('../components/WishScanner', () => ({
  default: ({ onCapture, onCancel }: { onCapture: any; onCancel: any }) => (
    <div data-testid="mock-wish-scanner">
      <button
        data-testid="mock-capture"
        onClick={() => onCapture('Camera OCR text', new Blob(['cam'], { type: 'image/jpeg' }))}
      >
        Capture
      </button>
      <button data-testid="mock-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

let mockEngineReject = false;

vi.mock('../cardProcessor', () => ({
  processCardImage: vi.fn(async () => {
    if (mockEngineReject) {
      throw new Error('OCR Engine Failed');
    }
    return {
      blob: new Blob(['mock data'], { type: 'image/jpeg' }),
      text: 'Mocked OCR Text from Card',
    };
  }),
}));

describe('EnterWishPage', () => {
  let originalImage: any;

  beforeEach(() => {
    mockEngineReject = false;

    originalImage = globalThis.Image;
    globalThis.Image = class {
      onload: any = null;
      onerror: any = null;
      _src: string = '';
      set src(s: string) {
        this._src = s;
        setTimeout(() => {
          if (this.onload) this.onload({} as any);
        }, 0);
      }
      get src() {
        return this._src;
      }
    } as any;

    vi.mocked(AuthContext.useAuth).mockReturnValue({ token: null });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'wish-1', secret: 'secret-code' }),
      })
    );
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('submits a wish and shows the success message', async () => {
    render(<EnterWishPage />);

    fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
      target: { value: 'I want a test.' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Leave blank for automatic code phrase/i), {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

    await waitFor(() => expect(screen.getByText(/Wish saved! ID:/i)).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/wishes',
      expect.objectContaining({ method: 'POST' })
    );

    // Flush any pending WishCard layout effects to prevent act() warnings
    await act(async () => {
      await flushPromises();
    });
  });

  it('shows error if API request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      })
    );

    render(<EnterWishPage />);
    fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
      target: { value: 'test wish' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

    expect(await screen.findByText(/Server error/i)).toBeInTheDocument();

    // Flush any pending WishCard layout effects to prevent act() warnings
    await act(async () => {
      await flushPromises();
    });
  });

  it('shows a friendly message and keeps the form when the server returns a non-JSON error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      })
    );

    render(<EnterWishPage />);
    fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
      target: { value: 'keep me' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

    expect(await screen.findByText(/try again/i)).toBeInTheDocument();
    // The form is preserved so the user can retry by hand.
    expect((screen.getByPlaceholderText(/Type your wish here/i) as HTMLTextAreaElement).value).toBe(
      'keep me'
    );

    await act(async () => {
      await flushPromises();
    });
  });

  it('shows a friendly message and keeps the form on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<EnterWishPage />);
    fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
      target: { value: 'keep me too' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect((screen.getByPlaceholderText(/Type your wish here/i) as HTMLTextAreaElement).value).toBe(
      'keep me too'
    );

    await act(async () => {
      await flushPromises();
    });
  });

  it('toggles Advanced Match Criteria', async () => {
    render(<EnterWishPage />);

    // Initially hidden
    expect(screen.queryByText(/Desired genders/i)).not.toBeInTheDocument();

    // Click toggle
    const toggle = screen.getByText(/Advanced Match Criteria/i);
    fireEvent.click(toggle);

    // Now visible
    expect(screen.getByText(/Strictly required genders/i)).toBeInTheDocument();
  });

  it('allows uploading a handwritten wish image', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mocked-url');
    URL.revokeObjectURL = vi.fn();
    render(<EnterWishPage />);

    const fileInput = screen.getByLabelText(/Upload Image/i);
    const mockFile = new File(['mock content'], 'wish.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByText(/Handwritten wish attached/i)).toBeInTheDocument();
    });

    // Verify remove functionality
    const removeBtn = screen.getByRole('button', { name: /Remove Image/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Handwritten wish attached/i)).not.toBeInTheDocument();
    });
  });

  it('rejects non-image file uploads', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mocked-url');
    render(<EnterWishPage />);

    const fileInput = screen.getByLabelText(/Upload Image/i);
    const mockFile = new File(['mock content'], 'test.txt', { type: 'text/plain' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [mockFile] } });
    });

    expect(screen.queryByText(/Handwritten wish attached/i)).not.toBeInTheDocument();
  });
  it('handles logged-in user UI appropriately', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ token: 'mock-token' });
    render(<EnterWishPage />);
    expect(
      screen.getByText(/Your account identity attributes are applied automatically to this wish./i)
    ).toBeInTheDocument();
  });

  it('allows capturing an image with camera', async () => {
    render(<EnterWishPage />);

    // Desktop view shows the Capture with Camera button
    const captureBtn = screen.getByRole('button', { name: /Capture with Camera/i });
    fireEvent.click(captureBtn);

    // Scanner should be rendered
    expect(await screen.findByTestId('mock-wish-scanner')).toBeInTheDocument();
  });

  it('allows capturing an image with camera, triggering capture and cancel callbacks', async () => {
    render(<EnterWishPage />);

    // Open scanner
    const captureBtn = screen.getByRole('button', { name: /Capture with Camera/i });
    fireEvent.click(captureBtn);

    // Trigger capture callback
    const triggerCaptureBtn = await screen.findByTestId('mock-capture');
    fireEvent.click(triggerCaptureBtn);

    // Scanner should be closed and content updated
    await waitFor(() => {
      expect(screen.queryByTestId('mock-wish-scanner')).not.toBeInTheDocument();
      expect(screen.getByText(/Handwritten wish attached/i)).toBeInTheDocument();
    });

    // Verify remove works
    const removeBtn = screen.getByRole('button', { name: /Remove Image/i });
    fireEvent.click(removeBtn);

    // Open scanner again and cancel
    const freshCaptureBtn = screen.getByRole('button', { name: /Capture with Camera/i });
    fireEvent.click(freshCaptureBtn);
    const triggerCancelBtn = await screen.findByTestId('mock-cancel');
    fireEvent.click(triggerCancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('mock-wish-scanner')).not.toBeInTheDocument();
    });
  });

  it('allows uploading a handwritten wish image and submitting it', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mocked-url');
    render(<EnterWishPage />);

    const fileInput = screen.getByLabelText(/Upload Image/i);
    const mockFile = new File(['mock content'], 'wish.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [mockFile] } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Handwritten wish attached/i)).toBeInTheDocument();
    });

    // Submit form with image
    fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

    await waitFor(() => expect(screen.getByText(/Wish saved! ID:/i)).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/wishes',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    );

    // Flush any pending layout effects
    await act(async () => {
      await flushPromises();
    });
  });

  it('handles image processing errors gracefully', async () => {
    mockEngineReject = true;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mocked-url');

    render(<EnterWishPage />);

    const fileInput = screen.getByLabelText(/Upload Image/i);
    const mockFile = new File(['mock content'], 'wish.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [mockFile] } });
    });

    // Error message should be visible
    await waitFor(() => {
      expect(screen.getByText(/OCR Engine Failed/i)).toBeInTheDocument();
    });
  });
});

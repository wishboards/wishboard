import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPage from './SearchPage';

let mockUser: any = null;

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    token: mockUser ? 'token' : null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

describe('SearchPage', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'wish-1',
          content: 'Hello world',
        },
      ],
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockUser = null;
  });

  it('submits search with manual query fields and renders results', async () => {
    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'hello' },
    });
    fireEvent.change(screen.getByLabelText(/Your Gender\(s\)/i), {
      target: { value: 'woman' },
    });
    fireEvent.change(screen.getByLabelText(/Your Orientation\(s\)/i), {
      target: { value: 'queer' },
    });
    fireEvent.change(screen.getByLabelText(/Your Role\(s\)/i), {
      target: { value: 'top' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('%22gender%22%3A%22woman%22')
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('%22orientation%22%3A%22queer%22')
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('%22role%22%3A%22top%22')
    );
  });

  it('handles empty results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as any;

    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'unknown' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('handles API errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Search failed' }),
    }) as any;

    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'error' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(screen.getByText(/Unable to perform search./i)).toBeInTheDocument());
  });

  it('does not error when clearing the search input', async () => {
    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });

  it('flags a search result wish and removes it from the list when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.startsWith('/api/wishes?')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'wish-1',
              content: 'Search result wish',
            },
          ],
        });
      }
      if (url === '/api/wishes/wish-1/flag' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as any;

    render(<SearchPage />);

    // Perform search
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    // Wait for the wish to be displayed
    await waitFor(() => expect(screen.getByText('Search result wish')).toBeInTheDocument());

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
    await waitFor(() => expect(screen.queryByText('Search result wish')).not.toBeInTheDocument());
  });

  it('searches using user profile attributes by default when logged in', async () => {
    mockUser = {
      username: 'testuser',
      genders: ['man'],
      orientations: ['straight'],
      roles: ['top'],
    };
    render(<SearchPage />);

    // Should render the filter checkbox
    const checkbox = screen.getByLabelText(/Filter results by my profile attributes/i);
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Since profile attributes are enabled, it does NOT set ignore_attributes=1
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/wishes?'));
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('ignore_attributes=1')
    );
  });

  it('allows disabling profile attribute filtering when logged in', async () => {
    mockUser = {
      username: 'testuser',
      genders: ['man'],
      orientations: ['straight'],
      roles: ['top'],
    };
    render(<SearchPage />);

    const checkbox = screen.getByLabelText(/Filter results by my profile attributes/i);
    fireEvent.click(checkbox); // uncheck it
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Since profile attributes are disabled, it sets ignore_attributes=1
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('ignore_attributes=1'));
  });

  it('allows admin users to delete a wish with confirmation', async () => {
    mockUser = { username: 'admin', role: 'admin' };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.startsWith('/api/wishes?')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'wish-admin', content: 'Admin delete test' }],
        });
      }
      if (url === '/api/admin/wishes/wish-admin/remove' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: false });
    });

    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(screen.getByText('Admin delete test')).toBeInTheDocument());

    const deleteBtn = screen.getByTitle(/Admin Delete Wish/i);
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(screen.queryByText('Admin delete test')).not.toBeInTheDocument());
  });

  it('allows excluding a wish and undoing the exclusion', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url.startsWith('/api/wishes?')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'wish-exclude', content: 'Excludable Wish' }],
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search existing wishes/i), {
      target: { value: 'Excludable' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(screen.getByText('Excludable Wish')).toBeInTheDocument());

    // 1. Exclude wish
    const excludeBtn = screen.getByTitle('Hide wish / Not interested');
    fireEvent.click(excludeBtn);

    expect(screen.queryByText('Excludable Wish')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo/i })).toBeInTheDocument();

    // 2. Undo exclusion
    const undoBtn = screen.getByRole('button', { name: /Undo/i });
    fireEvent.click(undoBtn);

    await waitFor(() => expect(screen.getByText('Excludable Wish')).toBeInTheDocument());
  });

  it('handles failed undo restoration gracefully', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'w10', content: 'Failing Undo Wish' }],
    } as any);

    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText('Search existing wishes'), {
      target: { value: 'Failing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => expect(screen.getByText('Failing Undo Wish')).toBeInTheDocument());

    const excludeBtn = screen.getByTitle('Hide wish / Not interested');
    fireEvent.click(excludeBtn);

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error on undo'));

    const undoBtn = screen.getByRole('button', { name: /Undo/i });
    fireEvent.click(undoBtn);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument()
    );
  });

  it('updates useProfileAttributes when user logs in dynamically', () => {
    mockUser = null;
    const { rerender } = render(<SearchPage />);
    expect(
      screen.queryByLabelText(/Filter results by my profile attributes/i)
    ).not.toBeInTheDocument();

    mockUser = { id: 'u1', username: 'carol', role: 'user', attributes: {} };
    rerender(<SearchPage />);
    const checkbox = screen.getByLabelText(
      /Filter results by my profile attributes/i
    ) as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
  });
});

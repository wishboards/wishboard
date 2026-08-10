import { delay } from '../utils/testUtils';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchPage from './SearchPage';
import React from 'react';
import * as AuthContext from '../AuthContext';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('SearchPage Coverage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('opens and closes SendWishmailModal', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ user: null } as any);
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/exclusions/list')) {
        return { ok: true, json: async () => [] };
      }
      return {
        ok: true,
        json: async () => [{ id: 'w1', content: 'Wish content', wishmail_enabled: true }],
      };
    });

    render(<SearchPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Wish content')).toBeInTheDocument());

    const sendMailBtn = screen.getByRole('button', { name: 'Send Wishmail' });
    fireEvent.click(sendMailBtn);

    await waitFor(() => expect(screen.getByText('Send Wishmail')).toBeInTheDocument());

    const closeBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(closeBtn);

    await waitFor(() => expect(screen.queryByText('Send Wishmail')).not.toBeInTheDocument());
  });
  it('handles search fetch failure gracefully', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ user: null } as unknown as ReturnType<
      typeof AuthContext.useAuth
    >);
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Search failed' }) });
    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText('Unable to perform search.')).toBeInTheDocument());
  });

  it('performs temporary search with attributes when unauthenticated', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ user: null } as unknown as ReturnType<
      typeof AuthContext.useAuth
    >);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'w2', content: 'Attribute Wish', wishmail_enabled: false }],
    });

    render(<SearchPage />);
    fireEvent.change(screen.getByLabelText(/Your Gender\(s\)/i), {
      target: { value: 'man' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('%22gender%22%3A%22man%22'))
    );
  });

  it('handles admin delete successfully', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: {
        id: 'u1',
        username: 'admin',
        role: 'admin',
      },
      token: 'fake-token',
    } as unknown as ReturnType<typeof AuthContext.useAuth>);

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/admin/wishes/w1/remove')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return {
        ok: true,
        json: async () => [{ id: 'w1', content: 'Test Wish', wishmail_enabled: false }],
      };
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Test Wish')).toBeInTheDocument());

    const deleteBtn = screen.getByTitle('Admin Delete Wish');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(screen.queryByText('Test Wish')).not.toBeInTheDocument());
  });

  it('handles admin delete error', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: {
        id: 'u1',
        username: 'admin',
        role: 'admin',
      },
      token: 'fake-token',
    } as unknown as ReturnType<typeof AuthContext.useAuth>);

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/admin/wishes/w1/remove')) {
        return { ok: false, json: async () => ({ error: 'Delete failed' }) };
      }
      return {
        ok: true,
        json: async () => [{ id: 'w1', content: 'Test Wish', wishmail_enabled: false }],
      };
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Test Wish')).toBeInTheDocument());

    const deleteBtn = screen.getByTitle('Admin Delete Wish');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to delete wish.'));
  });

  it('handles admin delete exception', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: {
        id: 'u1',
        username: 'admin',
        role: 'admin',
      },
      token: 'fake-token',
    } as unknown as ReturnType<typeof AuthContext.useAuth>);

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/admin/wishes/w1/remove')) {
        return Promise.reject(new Error('Network error'));
      }
      return {
        ok: true,
        json: async () => [{ id: 'w1', content: 'Test Wish', wishmail_enabled: false }],
      };
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Test Wish')).toBeInTheDocument());

    const deleteBtn = screen.getByTitle('Admin Delete Wish');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error deleting wish.'));
  });

  it('aborts admin delete if unconfirmed', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: {
        id: 'u1',
        username: 'admin',
        role: 'admin',
      },
      token: 'fake-token',
    } as unknown as ReturnType<typeof AuthContext.useAuth>);

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/exclusions/list')) {
        return { ok: true, json: async () => [] };
      }
      return {
        ok: true,
        json: async () => [{ id: 'w1', content: 'Test Wish', wishmail_enabled: false }],
      };
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Test Wish')).toBeInTheDocument());

    const deleteBtn = screen.getByTitle('Admin Delete Wish');
    fireEvent.click(deleteBtn);

    await delay(10);
    expect(screen.getByText('Test Wish')).toBeInTheDocument();
  });
});

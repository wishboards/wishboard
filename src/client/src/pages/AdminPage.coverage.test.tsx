import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminPage from './AdminPage';
import React from 'react';
import * as AuthContext from '../AuthContext';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AdminPage Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.location.hash = '';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('toggles sidebar expansion', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: { id: 'admin-id', username: 'admin', role: 'admin' },
      token: 'fake-token',
      login: vi.fn(),
      logout: vi.fn(),
      setToken: vi.fn(),
      deleteAccount: vi.fn(),
      updatePassword: vi.fn(),
    });

    render(<AdminPage />);
    await screen.findByText('No matching rules found.');

    // By default, sidebar is expanded, so it shows "◀ Collapse"
    const toggleBtn = screen.getByRole('button', { name: 'Toggle Sidebar' });
    expect(toggleBtn).toHaveTextContent('◀ Collapse');

    // Click to collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('▶');

    // Click to expand again
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('◀ Collapse');
  });

  it('updates location hash to #poster when Print Event Poster is clicked', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: { id: 'admin-id', username: 'admin', role: 'admin' },
      token: 'fake-token',
      login: vi.fn(),
      logout: vi.fn(),
      setToken: vi.fn(),
      deleteAccount: vi.fn(),
      updatePassword: vi.fn(),
    });

    render(<AdminPage />);
    await screen.findByText('No matching rules found.');

    const posterBtn = screen.getByTitle('Print Event Poster');
    fireEvent.click(posterBtn);

    expect(globalThis.location.hash).toBe('#poster');
  });
});

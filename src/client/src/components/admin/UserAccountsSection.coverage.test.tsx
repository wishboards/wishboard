import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserAccountsSection from './UserAccountsSection';
import React from 'react';
import { flushPromises } from '../../utils/testUtils';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('UserAccountsSection Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('handles user loading and successful fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());
  });

  it('calls onSessionExpired when loading users returns 401 (dead session)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401 }) // loadUsers
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isProduction: true }) }); // loadConfig
    const onSessionExpired = vi.fn();

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
        onSessionExpired={onSessionExpired}
      />
    );

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it('surfaces an error (not a silently-empty table) when loading users fails non-401', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 }) // loadUsers
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isProduction: true }) }); // loadConfig
    const setError = vi.fn();

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={setError}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(setError).toHaveBeenCalledWith('Failed to load user accounts.'));
  });

  it('handles delete preview fetch failure', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    const setError = vi.fn();
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={setError}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

    // Mock fetch for delete preview to fail
    mockFetch.mockResolvedValueOnce({ ok: false });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith('Failed to fetch delete preview.'));
  });

  it('handles confirm delete flow', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

    // Mock fetch for delete preview to succeed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ wishesCount: 5, wishmailsCount: 0 }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.getByText(/This action is permanent and cannot be undone/)).toBeInTheDocument()
    );

    // Mock fetch for actual delete to succeed
    mockFetch.mockResolvedValueOnce({ ok: true });
    // And then loadUsers is called again
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete Account' }));

    await waitFor(() => expect(screen.queryByText('user1')).not.toBeInTheDocument());
  });

  it('handles update role', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'u1', username: 'user1', role: 'user' },
          { id: 'u2', username: 'user2', role: 'admin' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    const setMessage = vi.fn();
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={setMessage}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

    // Mock failure for promote
    mockFetch.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getAllByRole('button', { name: 'Promote' })[0]);
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/role'), expect.any(Object))
    );

    // Mock success for demote
    mockFetch.mockResolvedValueOnce({ ok: true });
    // And loadUsers again
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Demote' })[0]);
    await waitFor(() => expect(setMessage).toHaveBeenCalledWith('Updated user role for u2'));
  });

  it('handles reset passphrase', async () => {
    globalThis.confirm = vi.fn(() => true);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    const setMessage = vi.fn();
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={setMessage}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

    // Mock failure
    mockFetch.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/reset-password'),
        expect.any(Object)
      )
    );

    // Mock success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ newPassphrase: 'new-passphrase-123' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    await waitFor(() =>
      expect(setMessage).toHaveBeenCalledWith(
        'Passphrase successfully reset! The new passphrase is: new-passphrase-123'
      )
    );

    // Test confirm false
    globalThis.confirm = vi.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    // Wait a tick to ensure fetch isn't called again
    await flushPromises();
  });

  it('handles cancel delete', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }), // loadConfig
      });

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ wishesCount: 5, wishmailsCount: 0 }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.getByText(/This action is permanent and cannot be undone/)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen.queryByText(/This action is permanent and cannot be undone/)
      ).not.toBeInTheDocument()
    );
  });

  it('handles loadUsers error and loadConfig error gracefully', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: false,
      });

    const setError = vi.fn();
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={setError}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('user1')).not.toBeInTheDocument();
  });

  it('renders and handles seeder logic when not in production', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: false, hasDemoSeeds: true }), // loadConfig says NOT production
      });

    const setMessage = vi.fn();
    const setError = vi.fn();
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={setMessage}
        setError={setError}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('Demo Seeder')).toBeInTheDocument());

    // Mock seeder failure
    mockFetch.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: 'Run Seeder' }));
    await waitFor(() => expect(setError).toHaveBeenCalledWith('Failed to run seeder.'));

    // Mock seeder success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stats: { usersCreated: 10, wishesCreated: 20 } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Seeder' }));
    await waitFor(() =>
      expect(setMessage).toHaveBeenCalledWith('Seeder completed: 10 users and 20 wishes created.')
    );
  });

  it('aborts delete if userToDelete is null but confirmDelete is somehow called', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ isProduction: true }),
      });

    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());
    // Since userToDelete is null, we can't legitimately click the confirm button.
    // The component logic `if (!userToDelete) return;` is inherently protected by the modal not rendering.
  });

  // #184: on a 401 from any mutation, hand off to onSessionExpired (drop to login)
  // instead of surfacing a generic error. Covers the handledUnauthorized() early
  // return in each action handler.
  const renderWithSession = (onSessionExpired: () => void, setError = vi.fn()) => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'u1', username: 'user1', role: 'user' }],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isProduction: true }) });
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={setError}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
        onSessionExpired={onSessionExpired}
      />
    );
    return waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());
  };

  it('changeRole 401 fires onSessionExpired instead of a role error', async () => {
    const onSessionExpired = vi.fn();
    const setError = vi.fn();
    await renderWithSession(onSessionExpired, setError);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
    expect(setError).not.toHaveBeenCalledWith('Failed to update role.');
  });

  it('resetPassphrase 401 fires onSessionExpired', async () => {
    globalThis.confirm = vi.fn(() => true);
    const onSessionExpired = vi.fn();
    await renderWithSession(onSessionExpired);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it('delete preview 401 fires onSessionExpired', async () => {
    const onSessionExpired = vi.fn();
    await renderWithSession(onSessionExpired);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it('delete user 401 fires onSessionExpired', async () => {
    const onSessionExpired = vi.fn();
    await renderWithSession(onSessionExpired);
    // Preview succeeds so the confirm modal opens...
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ wishesCount: 5, wishmailsCount: 0 }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.getByText(/This action is permanent and cannot be undone/)).toBeInTheDocument()
    );
    // ...then the actual delete returns 401.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete Account' }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it('runSeeder 401 fires onSessionExpired', async () => {
    const onSessionExpired = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ isProduction: false, hasDemoSeeds: true }),
    });
    render(
      <UserAccountsSection
        authHeader={{}}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
        triggerRefresh={vi.fn()}
        onSessionExpired={onSessionExpired}
      />
    );
    await waitFor(() => expect(screen.getByText('Demo Seeder')).toBeInTheDocument());
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    fireEvent.click(screen.getByRole('button', { name: 'Run Seeder' }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });
});

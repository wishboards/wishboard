import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import AdminPage from './AdminPage';
import { extractUrl } from '../../../../tests/testUtils';

let mockUser: any = null;
let mockToken: any = null;
const loginMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    token: mockToken,
    login: loginMock,
    logout: logoutMock,
  }),
}));

describe('AdminPage', () => {
  const fetchMatchers = [
    {
      test: (url: string) => url.endsWith('/api/admin/flags'),
      handler: () =>
        mockToken
          ? {
              ok: true,
              json: async () => [
                { id: 'flagged-1', content: 'Flagged wish', flagged: 1, user_id: 'user-2' },
              ],
            }
          : { ok: false, status: 401 },
    },
    {
      test: (url: string) => url.endsWith('/api/admin/users'),
      handler: () =>
        mockToken
          ? {
              ok: true,
              json: async () => [
                { id: 'user-1', username: 'tester', role: 'user' },
                { id: 'admin-2', username: 'other-admin', role: 'admin' },
              ],
            }
          : { ok: false, status: 401 },
    },
    {
      test: (url: string) => url.includes('/api/admin/logs'),
      handler: () =>
        mockToken
          ? { ok: true, json: async () => ({ logs: 'Test logs output' }) }
          : { ok: false, status: 401 },
    },
    {
      test: (url: string) => url.endsWith('/api/admin/config'),
      handler: () => ({
        ok: true,
        json: async () => ({ isProduction: false, hasDemoSeeds: true }),
      }),
    },
    {
      test: (url: string) => url.endsWith('/api/config'),
      handler: () => ({ ok: true, json: async () => ({ realtimeProvider: 'socketio' }) }),
    },
    {
      test: (url: string) => url.endsWith('/api/admin/local-metrics'),
      handler: () => ({
        ok: true,
        json: async () => ({
          osSamples: [],
          httpSamples: [],
          intervalMs: 5000,
          generatedAt: new Date().toISOString(),
        }),
      }),
    },
    {
      test: (url: string) => url.endsWith('/api/admin/reset-demo'),
      handler: () => ({
        ok: true,
        json: async () => ({ stats: { usersCreated: 50, wishesCreated: 100 } }),
      }),
    },
    {
      test: (url: string) => url.includes('/api/rules'),
      handler: (options?: any) => {
        if (
          options?.method === 'PUT' ||
          options?.method === 'POST' ||
          options?.method === 'DELETE'
        ) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return {
          ok: true,
          json: async () => [
            {
              id: 'rule-1',
              rule_type: 'expansion',
              trigger_attribute: 'role',
              trigger_value: 'pet',
              target_attribute: 'role',
              target_value: 'pup',
            },
          ],
        };
      },
    },
    {
      test: (url: string) => url.includes('/api/admin/wishes/') && url.endsWith('/remove'),
      handler: () => ({ ok: true }),
    },
    {
      test: (url: string) => url.includes('/api/admin/wishes/') && url.endsWith('/clear-flag'),
      handler: () => ({ ok: true }),
    },
    {
      test: (url: string) => url.endsWith('/api/admin/wishes/clear-all-flags'),
      handler: () => ({ ok: true }),
    },
    {
      test: (url: string) => url.includes('/api/admin/users/') && url.endsWith('/role'),
      handler: () => ({ ok: true }),
    },
    {
      test: (url: string) => url.includes('/api/admin/users/') && url.endsWith('/delete-preview'),
      handler: () => ({ ok: true, json: async () => ({ wishesCount: 5, wishmailsCount: 2 }) }),
    },
    {
      test: (url: string) => url.includes('/api/admin/users/') && url.endsWith('/delete'),
      handler: () => ({ ok: true }),
    },
  ];

  beforeEach(() => {
    globalThis.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockUser = null;
    mockToken = null;
    loginMock.mockReset();
    logoutMock.mockReset();

    globalThis.fetch = vi.fn().mockImplementation((input, options) => {
      const url = extractUrl(input as RequestInfo | URL);
      const matcher = fetchMatchers.find((m) => m.test(url));
      if (matcher) {
        return Promise.resolve(matcher.handler(options));
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unknown' }) });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis.HTMLElement.prototype as any).scrollIntoView = undefined;
  });

  it('renders login form when user is not admin', async () => {
    render(<AdminPage />);
    expect(screen.getByText('Admin username')).toBeInTheDocument();
    expect(screen.getByText('Admin passphrase')).toBeInTheDocument();
  });

  it('handles login form submission successfully', async () => {
    loginMock.mockResolvedValueOnce({ success: true, role: 'admin' });
    render(<AdminPage />);

    fireEvent.change(screen.getByLabelText(/Admin username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Admin passphrase/i), { target: { value: 'pass' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Login as Admin/i }));
    });

    expect(loginMock).toHaveBeenCalledWith('admin', 'pass');
    await waitFor(() => {
      expect(screen.getByText('Admin login successful.')).toBeInTheDocument();
    });
  });

  it('handles non-admin login role restriction', async () => {
    loginMock.mockResolvedValueOnce({ success: true, role: 'user' });
    render(<AdminPage />);

    fireEvent.change(screen.getByLabelText(/Admin username/i), { target: { value: 'user1' } });
    fireEvent.change(screen.getByLabelText(/Admin passphrase/i), { target: { value: 'pass' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Login as Admin/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText('Logged in successfully, but this account is not an admin.')
      ).toBeInTheDocument();
    });
  });

  it('handles login errors', async () => {
    loginMock.mockResolvedValueOnce({ success: false, error: 'Wrong password' });
    render(<AdminPage />);

    fireEvent.change(screen.getByLabelText(/Admin username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Admin passphrase/i), { target: { value: 'wrong' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Login as Admin/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Wrong password')).toBeInTheDocument();
    });
  });

  it('renders dashboard when logged in as admin', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    render(<AdminPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flags/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Flagged wish')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Users/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('tester')).toBeInTheDocument();
      expect(screen.getByText('other-admin')).toBeInTheDocument();
    });
  });

  it('can remove a flagged wish', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flags/i }));
    });

    await waitFor(() => expect(screen.getByText('Flagged wish')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Removed wish flagged-1')).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/wishes/flagged-1/remove',
      expect.any(Object)
    );
  });

  it('can run demo seeder', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Users/i }));
    });

    await waitFor(() => expect(screen.getByText('Demo Seeder')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run Seeder/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText('Seeder completed: 50 users and 100 wishes created.')
      ).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/admin/reset-demo', expect.any(Object));
  });

  it('handles fetch errors gracefully when loading dashboard', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flags/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Unable to load flagged wishes.')).toBeInTheDocument();
    });
  });

  it('handles failure when running seeder', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    globalThis.fetch = vi.fn().mockImplementation((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.endsWith('/api/admin/flags')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.endsWith('/api/admin/users')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'user-1', username: 'tester', role: 'user' }],
        });
      }
      if (url.endsWith('/api/admin/reset-demo')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      if (url.includes('/api/admin/logs')) {
        return Promise.resolve({ ok: true, json: async () => ({ logs: 'logs' }) });
      }
      if (url.endsWith('/api/rules')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.endsWith('/api/admin/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ isProduction: false, hasDemoSeeds: true }),
        });
      }
      if (url.includes('/api/config')) {
        return Promise.resolve({ ok: true, json: async () => ({ realtimeProvider: 'socketio' }) });
      }
      if (url.includes('/api/admin/local-metrics')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            osSamples: [],
            httpSamples: [],
            intervalMs: 5000,
            generatedAt: new Date().toISOString(),
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: 'Unknown' }),
      });
    });

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Users/i }));
    });

    await waitFor(() => expect(screen.getByText('tester')).toBeInTheDocument());

    // Try run seeder
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run Seeder/i }));
    });
    await waitFor(() => expect(screen.getByText('Failed to run seeder.')).toBeInTheDocument());
  });

  it('can clear flag on a single wish', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flags/i }));
    });

    await waitFor(() => expect(screen.getByText('Flagged wish')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Clear Flag/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Cleared flag for wish flagged-1')).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/wishes/flagged-1/clear-flag',
      expect.any(Object)
    );
  });

  it('can clear all flags in bulk', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flags/i }));
    });

    await waitFor(() => expect(screen.getByText('Flagged wish')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Clear All Flags/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Cleared all flags successfully.')).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/wishes/clear-all-flags',
      expect.any(Object)
    );
  });

  it('can view logs and toggle tailing', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';
    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /System/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Test logs output')).toBeInTheDocument();
    });

    // Toggle live tail
    const toggleButton = screen.getByRole('button', { name: /Pause Tailing/i });
    await act(async () => {
      fireEvent.click(toggleButton);
    });
    expect(screen.getByRole('button', { name: /Resume Tailing/i })).toBeInTheDocument();
  });

  it('can view metrics dashboard in system overview', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    globalThis.fetch = vi.fn().mockImplementation((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/config')) {
        return Promise.resolve({ ok: true, json: async () => ({ realtimeProvider: 'socketio' }) });
      }
      if (url.includes('/api/admin/logs')) {
        return Promise.resolve({ ok: true, json: async () => ({ logs: 'Test logs output' }) });
      }
      if (url.includes('/api/admin/local-metrics')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            osSamples: [],
            httpSamples: [],
            intervalMs: 5000,
            generatedAt: new Date().toISOString(),
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /System/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/live in-process metrics/i)).toBeInTheDocument();
    });
  });

  it('handles fetch exceptions during initial load', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/admin/logs')) {
        throw new Error('Network fail');
      }
      if (url.includes('/api/config')) {
        return { ok: true, json: async () => ({ realtimeProvider: 'socketio' }) };
      }
      if (url.includes('/api/admin/local-metrics')) {
        return {
          ok: true,
          json: async () => ({
            osSamples: [],
            httpSamples: [],
            intervalMs: 5000,
            generatedAt: new Date().toISOString(),
          }),
        };
      }
      return { ok: true, json: async () => [] };
    });

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /System/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to load logs.')).toBeInTheDocument();
    });
  });

  it('can edit and save a matching rule', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('role = pup')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    await act(async () => {
      fireEvent.click(editButtons[0]);
    });

    // Form should scroll and populate
    const targetValueInput = screen.getByLabelText(/Target Value/i);
    expect(targetValueInput).toHaveValue('pup');

    // Change value
    await act(async () => {
      fireEvent.change(targetValueInput, { target: { value: 'pup, kitten' } });
    });

    // Save changes
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Rule updated successfully.')).toBeInTheDocument();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/rules/rule-1'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('a 401 from an admin call logs out and shows a session-expired message (#184)', async () => {
    mockUser = { id: 'admin-id', username: 'admin', role: 'admin' };
    mockToken = 'admin-token';

    // Force the Users list to 401 (dead/expired/orphaned session) while the admin
    // UI is up, so onSessionExpired -> handleSessionExpired -> logout + message.
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/admin/users')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as any;
      }
      if (url.includes('/api/admin/config'))
        return { ok: true, json: async () => ({ isProduction: false }) } as any;
      if (url.includes('/api/config'))
        return { ok: true, json: async () => ({ realtimeProvider: 'socketio' }) } as any;
      return { ok: true, json: async () => [] } as any;
    }) as any;

    render(<AdminPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Users/i }));
    });

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    expect(screen.getByText(/session expired or is no longer valid/i)).toBeInTheDocument();
  });
});

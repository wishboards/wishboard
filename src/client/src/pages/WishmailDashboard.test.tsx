import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WishmailDashboard from './WishmailDashboard';
import React from 'react';
import * as AuthContext from '../AuthContext';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockFetch = vi.fn();

describe('WishmailDashboard', () => {
  beforeEach(() => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ token: 'mock-token' } as any);
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
    globalThis.window.location.hash = '#wishmail?id=w1&secret=sec123';
  });

  it('fetches and displays wishmails successfully', async () => {
    const mockMails = [
      {
        id: 'm1',
        content: 'Message 1',
        return_contacts: [{ type: 'Phone', value: '123' }],
        read: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'm2',
        content: 'Message 2',
        return_contacts: [],
        read: true,
        created_at: '2026-01-02T00:00:00Z',
      },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockMails });

    render(<WishmailDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Message 1')).toBeInTheDocument();
      expect(screen.getByText('Message 2')).toBeInTheDocument();
    });

    expect(screen.getByText('Return Contacts')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();
  });

  it('displays error if fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    render(<WishmailDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText('Not authorized to view wishmail for this wish, or wish not found.')
      ).toBeInTheDocument();
    });
  });

  it('displays error if no wish ID is provided', () => {
    globalThis.window.location.hash = '#wishmail';
    render(<WishmailDashboard />);
    expect(screen.getByText('No wish ID provided.')).toBeInTheDocument();
  });

  it('displays error if wish ID format is invalid', () => {
    globalThis.window.location.hash = '#wishmail?id=invalid!id&secret=sec123';
    render(<WishmailDashboard />);
    expect(screen.getByText('Invalid wish ID format.')).toBeInTheDocument();
  });

  it('displays error if secret format is invalid', () => {
    globalThis.window.location.hash = '#wishmail?id=w1&secret=invalid!secret';
    render(<WishmailDashboard />);
    expect(screen.getByText('Invalid secret format.')).toBeInTheDocument();
  });

  it('marks wishmail as read', async () => {
    const mockMails = [
      {
        id: 'm1',
        content: 'Message 1',
        return_contacts: [],
        read: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockMails });

    render(<WishmailDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark as Read' })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce({ ok: true });

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Read' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/wishes/w1/mail/m1/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ secret: 'sec123' }),
      });
      expect(screen.queryByRole('button', { name: 'Mark as Read' })).not.toBeInTheDocument();
    });
  });
});

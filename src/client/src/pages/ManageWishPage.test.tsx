import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ManageWishPage from './ManageWishPage';
import EventProfileContext from '../EventProfileContext';
import React from 'react';

// Setup fetch mock
globalThis.fetch = vi.fn();

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

describe('ManageWishPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.window.location.hash = '';
  });

  it('shows error if no wish ID is provided', () => {
    render(<ManageWishPage />);
    expect(screen.getByText('No wish ID provided.')).toBeInTheDocument();
  });

  it('fetches wish data on load and pre-fills the secret', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w1&secret=mysec';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'w1', content: 'Wish content' }),
    } as any);

    render(<ManageWishPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Manage Your Wish')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Wish content')).toBeInTheDocument();
    expect(screen.getByDisplayValue('mysec')).toBeInTheDocument();
  });

  it('shows error if wish is not found', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w2';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Not found' }),
    } as any);

    render(<ManageWishPage />);

    await waitFor(() => {
      expect(screen.getByText('Wish not found')).toBeInTheDocument();
    });
  });

  it('updates wish content on form submit', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w3&secret=sec';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'w3', content: 'Old content' }),
    } as any);

    render(<ManageWishPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Your Wish')).toBeInTheDocument();
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const textarea = screen.getByRole('textbox', { name: /What is your wish\?/i });
    fireEvent.change(textarea, { target: { value: 'New content' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/wishes/w3/manage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            secret: 'sec',
            content: 'New content',
            contacts: [],
            wishmail_enabled: false,
            new_passphrase: 'sec',
            action: 'update',
          }),
        })
      );
      expect(screen.getByText('Wish updated successfully!')).toBeInTheDocument();
    });
  });

  it('deletes wish on delete button click', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w4&secret=sec';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'w4', content: 'Old content' }),
    } as any);

    render(<ManageWishPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Your Wish')).toBeInTheDocument();
    });

    globalThis.window.confirm = vi.fn().mockReturnValueOnce(true);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Wish' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/wishes/w4/manage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ secret: 'sec', action: 'delete' }),
        })
      );
      expect(screen.getByText('Wish deleted successfully.')).toBeInTheDocument();
    });
  });

  it('handles invalid secret format and invalid wish id format', async () => {
    globalThis.window.location.hash = '#manage-wish?id=invalid!id&secret=invalid!secret';
    render(<ManageWishPage />);
    await waitFor(() => {
      expect(screen.getByText('Invalid secret format.')).toBeInTheDocument();
    });
  });

  it('updates wish and updates location hash when newSecret is returned', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w5&secret=sec123';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'w5', content: 'Original', wishmail_enabled: true }),
    } as any);

    render(<ManageWishPage />);
    await waitFor(() => expect(screen.getByText('Manage Your Wish')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: /View Wishmail/i })).toHaveAttribute(
      'href',
      '#wishmail-dashboard?id=w5&secret=sec123'
    );

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ newSecret: 'newsec456' }),
    } as any);

    fireEvent.submit(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(screen.getByText('Wish updated successfully!')).toBeInTheDocument());
  });

  it('handles error responses in save update, deactivate, and delete actions', async () => {
    globalThis.window.location.hash = '#manage-wish?id=w4&secret=sec';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'w4', content: 'Old content', is_active: true }),
    } as any);

    render(<ManageWishPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Your Wish')).toBeInTheDocument();
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Update failed' }),
    } as any);

    fireEvent.submit(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(screen.getByText('Update failed')).toBeInTheDocument());

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as any);

    fireEvent.click(screen.getByRole('button', { name: /Deactivate Wish/i }));
    await waitFor(() => expect(screen.getByText('Failed to deactivate wish.')).toBeInTheDocument());

    globalThis.window.confirm = vi.fn().mockReturnValueOnce(true);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Delete error' }),
    } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Wish' }));
    await waitFor(() => expect(screen.getByText('Delete error')).toBeInTheDocument());
  });

  it('loads and saves per-wish attribute overrides when categories are present', async () => {
    const profileWithCategories = {
      profile: 'lifestyle',
      contact_methods: ['Email'],
      categories: [
        { id: 'gender', label: 'Gender', suggestions: ['Woman', 'Nonbinary'] },
        { id: 'role', label: 'Role', suggestions: ['Switch', 'Rigger'] },
      ],
      realtimeProvider: 'socketio',
      apIp: '',
      isServerless: false,
    };

    globalThis.window.location.hash = '#manage-wish?id=w-attr&secret=sec';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'w-attr',
        content: 'Rope play wish',
        creator_attributes: { gender: ['Woman'], role: ['Switch'] },
        desired_attributes: { role: ['Rigger'] },
        is_active: true,
      }),
    } as any);

    render(
      <EventProfileContext value={profileWithCategories}>
        <ManageWishPage />
      </EventProfileContext>
    );

    await waitFor(() => expect(screen.getByDisplayValue('Woman')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Switch')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Rigger')).toBeInTheDocument();

    const desiredRoleInput = screen.getByLabelText(/Desired Role\(s\)/i);
    fireEvent.change(desiredRoleInput, { target: { value: 'Rigger, Top' } });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const postCall = vi.mocked(globalThis.fetch).mock.calls[1];
      expect(postCall[0]).toBe('/api/wishes/w-attr/manage');
      const sentBody = JSON.parse((postCall[1] as RequestInit).body as string);
      expect(sentBody.creator_attributes).toEqual({ gender: 'Woman', role: 'Switch' });
      expect(sentBody.desired_attributes).toEqual({ role: 'Rigger, Top' });
    });
  });

  it('subscribes to wish:suggestions:<id> and dynamically shows AI badge when wish:ai_suggestions_ready arrives', async () => {
    const { io } = await import('socket.io-client');
    const socket = (
      io as unknown as () => {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
        emit: ReturnType<typeof vi.fn>;
      }
    )();

    globalThis.window.location.hash = '#manage-wish?id=w-live&secret=live-sec';
    vi.mocked(globalThis.fetch).mockImplementation((async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/suggestions')) {
        return new Response(
          JSON.stringify([
            {
              id: 'sugg-live',
              wish_id: 'w-live',
              suggested_creator_attributes: { role: ['Switch'] },
              suggested_desired_attributes: {},
              status: 'pending',
              created_at: new Date().toISOString(),
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return {
        ok: true,
        json: async () => ({
          id: 'w-live',
          content: 'Live AI wish',
          is_active: true,
          pending_suggestions_count: 0,
        }),
      } as Response;
    }) as typeof globalThis.fetch);

    render(<ManageWishPage />);

    await waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('subscribe', {
        channel: 'wish:suggestions:w-live',
        token: undefined,
        secret: 'live-sec',
      });
    });

    expect(screen.queryByRole('button', { name: /View 1 AI suggestion/i })).not.toBeInTheDocument();

    const readyHandler = socket.on.mock.calls.find(
      ([evt]: [string]) => evt === 'wish:ai_suggestions_ready'
    )?.[1];
    expect(readyHandler).toBeTypeOf('function');

    readyHandler({ wish_id: 'w-live', suggestion_id: 'sugg-live' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View 1 AI suggestion/i })).toBeInTheDocument();
    });
  });
});

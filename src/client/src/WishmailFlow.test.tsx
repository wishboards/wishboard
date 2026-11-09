import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';

describe('Wishmail UI Flow', () => {
  beforeEach(() => {
    // Reset hash
    globalThis.window.location.hash = '';

    // Create a mini fake backend
    const wishes: any[] = [];
    let mails: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      if (url.startsWith('/api/users/exists')) {
        return { ok: true, json: async () => ({ exists: true }) };
      }

      // Mock Login & Me
      if (url === '/api/users/login' || url === '/api/users/me') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            token: 'fake-token',
            id: 'u1',
            username: 'usera',
            contacts: [],
          }),
        };
      }

      // Mock Create Wish
      if (url === '/api/wishes' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        const newWish = { id: 'w1', author_id: 'u1', ...body };
        wishes.push(newWish);
        return { ok: true, json: async () => newWish };
      }
      // Mock Get Single Wish
      if (url === '/api/wishes/w1' && (!options?.method || options.method === 'GET')) {
        const wish = wishes.find((w) => w.id === 'w1');
        return wish
          ? { ok: true, json: async () => wish }
          : { ok: false, json: async () => ({ error: 'Not found' }) };
      }
      // Mock Get Wishes
      if (url === '/api/users/me/wishes') {
        return { ok: true, json: async () => wishes };
      }

      // Mock Send Wishmail
      if (/^\/api\/wishes\/w1\/mail$/.test(url) && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        const newMail = { id: 'm1', ...body, read: false, created_at: new Date().toISOString() };
        mails.push(newMail);
        return { ok: true, json: async () => ({ success: true, id: 'm1' }) };
      }

      // Mock Get Wishmail
      if (url.startsWith('/api/wishes/w1/mail') && (!options?.method || options.method === 'GET')) {
        return { ok: true, json: async () => mails };
      }

      // Mock Delete Wishmail
      if (/^\/api\/wishes\/w1\/mail\/m1$/.test(url) && options?.method === 'DELETE') {
        mails = mails.filter((m) => m.id !== 'm1');
        return { ok: true, json: async () => ({ success: true }) };
      }

      return { ok: false, json: async () => ({ error: 'Not found' }) };
    });
  });

  it('navigates through the Wishmail flow in the UI', async () => {
    render(<App />);

    // 1. Go to Login
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    // Simulate typing username (auto-debounces and transitions mode to Login for existing user)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'usera' } });

    // Wait for debounced existence check to switch submit button to Login
    const loginButton = await screen.findByRole('button', { name: 'Login' });

    // Enter passphrase and submit login
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'passwordA' } });
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByText(/Welcome back, usera/i)).toBeInTheDocument();
    });

    // 2. Go to Enter Wish
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter a Wish' })[0]);

    // Enable wishmail
    const wishmailCheckbox = screen.getByLabelText(/Enable Wishmail/i);
    fireEvent.click(wishmailCheckbox);

    // Submit wish
    fireEvent.change(screen.getByPlaceholderText('Type your wish here'), {
      target: { value: 'My cool wish' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Wish' }));

    await waitFor(() => {
      expect(screen.getByText(/Wish saved! ID:/i)).toBeInTheDocument();
    });

    // 3. User goes to Account to see their wish
    const accountButtons = screen.getAllByRole('button', { name: 'My Account' });
    fireEvent.click(accountButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View Wishmail' })).toBeInTheDocument();
    });

    // 4. Simulate receiving a wishmail (by injecting it into our fake backend)
    await globalThis.fetch('/api/wishes/w1/mail', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello there' }),
    });

    // 5. Click View Wishmail
    fireEvent.click(screen.getByRole('button', { name: 'View Wishmail' }));

    await waitFor(() => {
      expect(screen.getByText('Wishmail')).toBeInTheDocument();
      expect(screen.getByText('Hello there')).toBeInTheDocument();
    });

    // 6. Delete the wishmail
    // Since globalThis.window.confirm is used, we must mock it
    const confirmSpy = vi.spyOn(globalThis.window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
      expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  }, 15000);
});

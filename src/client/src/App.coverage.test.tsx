import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App';
import React from 'react';

vi.mock('./pages/HomePage', () => ({ default: () => <div>HomePage Mock</div> }));
vi.mock('./pages/DisplayPage', () => ({
  default: ({ onEnterKiosk, isKiosk }: { onEnterKiosk: () => void; isKiosk: boolean }) => (
    <div>
      <div>DisplayPage Mock</div>
      <div>Is Kiosk: {isKiosk ? 'Yes' : 'No'}</div>
      <button onClick={onEnterKiosk}>Enter Kiosk</button>
    </div>
  ),
}));
vi.mock('./AccountPage', () => ({ default: () => <div>AccountPage Mock</div> }));
vi.mock('./components/WiFiQrCode', () => ({ default: () => <div>WiFiQrCode Mock</div> }));

const mockLogin = vi.fn();
const mockSetTokenExternally = vi.fn();

vi.mock('./AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: () => ({
    user: { username: 'testuser' },
    login: mockLogin,
    logout: vi.fn(),
    setTokenExternally: mockSetTokenExternally,
  }),
}));

describe('App Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window.location.hash = '#home';
  });

  it('handles auto-login token in hash', () => {
    globalThis.window.location.hash = '#account?token=12345';
    render(<App />);
    expect(mockSetTokenExternally).toHaveBeenCalledWith('12345');
    expect(globalThis.window.location.hash).toBe('#account');
  });

  it('renders default home page navigation', () => {
    render(<App />);
    expect(screen.getAllByRole('navigation')[0]).toBeInTheDocument();
  });

  it('navigates to account when clicking user link', async () => {
    render(<App />);
    const userLink = await screen.findByText('testuser');
    fireEvent.click(userLink);
    await waitFor(() => {
      expect(globalThis.window.location.hash).toBe('#account');
    });
  });

  it('handles kiosk exit error', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Network error'));

    globalThis.window.location.hash = '#display?kiosk=true';
    render(<App />);

    fireEvent.keyDown(globalThis.window, { key: 'Escape', code: 'Escape' });
    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'pass' },
    });

    const form = screen.getByPlaceholderText('e.g. admin').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('An error occurred during authentication.')).toBeInTheDocument();
    });
  });

  it('handles kiosk exit invalid credentials without explicit error string', async () => {
    mockLogin.mockResolvedValueOnce({ success: false });

    globalThis.window.location.hash = '#display?kiosk=true';
    render(<App />);

    fireEvent.keyDown(globalThis.window, { key: 'Escape', code: 'Escape' });
    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'pass' },
    });

    const form = screen.getByPlaceholderText('e.g. admin').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials.')).toBeInTheDocument();
    });
  });

  it('cleans up kiosk params from url upon successful exit', async () => {
    mockLogin.mockResolvedValueOnce({ success: true, role: 'admin' });

    globalThis.window.history.replaceState({}, '', '/?kiosk=true#display?kiosk=true');
    const replaceSpy = vi.spyOn(globalThis.window.history, 'replaceState');
    render(<App />);

    fireEvent.keyDown(globalThis.window, { key: 'Escape', code: 'Escape' });
    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'pass' },
    });

    const form = screen.getByPlaceholderText('e.g. admin').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalled();
      const newUrl = replaceSpy.mock.calls[0][2] as string;
      expect(newUrl).not.toContain('kiosk=true');
      expect(globalThis.window.location.hash).not.toContain('kiosk=true');
    });
  });

  it('renders display page normally and enters kiosk via button', async () => {
    globalThis.window.location.hash = '#display';
    render(<App />);
    const enterKioskBtn = await screen.findByText('Enter Kiosk');
    fireEvent.click(enterKioskBtn);
    await waitFor(() => {
      expect(screen.getByText('Is Kiosk: Yes')).toBeInTheDocument();
    });
  });

  it('navigates through mobile tab bar', async () => {
    globalThis.window.location.hash = '#home';
    render(<App />);
    const searchTab = screen
      .getAllByText('Search Wishes')[1]
      .closest('button') as HTMLButtonElement;
    fireEvent.click(searchTab);
    expect(globalThis.window.location.hash).toBe('#search');
  });

  it('toggles mobile hamburger menu and navigates', async () => {
    render(<App />);
    const moreTab = screen.getByText('More').closest('button') as HTMLButtonElement;
    fireEvent.click(moreTab);

    // Test navigation inside hamburger
    const aboutBtn = screen
      .getAllByText('About')
      .find((el) => el.tagName === 'BUTTON' && el.className.includes('hamburger-item'));
    if (aboutBtn) {
      fireEvent.click(aboutBtn);
      expect(globalThis.window.location.hash).toBe('#about');
    }

    fireEvent.click(moreTab);
    const adminBtn = screen
      .getAllByText('Admin')
      .find((el) => el.tagName === 'BUTTON' && el.className.includes('hamburger-item'));
    if (adminBtn) {
      fireEvent.click(adminBtn);
      expect(globalThis.window.location.hash).toBe('#admin');
    }
  });

  it('closes mobile hamburger menu with Escape key', async () => {
    render(<App />);
    const moreTab = screen.getByText('More').closest('button') as HTMLButtonElement;
    fireEvent.click(moreTab);

    // Wait for the menu overlay to be in document. It has aria-label="Close menu".
    const closeMenuArea = screen.getByLabelText('Close menu');
    fireEvent.keyDown(closeMenuArea, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Close menu')).not.toBeInTheDocument();
    });
  });

  it('closes mobile hamburger menu with X button', async () => {
    render(<App />);
    const moreTab = screen.getByText('More').closest('button') as HTMLButtonElement;
    fireEvent.click(moreTab);

    // The X button has text ✕
    const xBtn = screen.getByText('✕');
    fireEvent.click(xBtn);

    await waitFor(() => {
      expect(screen.queryByLabelText('Close menu')).not.toBeInTheDocument();
    });
  });

  it('cancels kiosk exit prompt', async () => {
    globalThis.window.location.hash = '#display?kiosk=true';
    render(<App />);

    fireEvent.keyDown(globalThis.window, { key: 'Escape', code: 'Escape' });

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Exit Kiosk Mode')).not.toBeInTheDocument();
    });
  });

  it('handles kiosk exit error for non-admin user', async () => {
    mockLogin.mockResolvedValueOnce({ success: true, role: 'user' });

    globalThis.window.location.hash = '#display?kiosk=true';
    render(<App />);

    fireEvent.keyDown(globalThis.window, { key: 'Escape', code: 'Escape' });
    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'user' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'pass' },
    });

    const form = screen.getByPlaceholderText('e.g. admin').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByText('Access denied: You must be an admin to exit kiosk mode.')
      ).toBeInTheDocument();
    });
  });
});

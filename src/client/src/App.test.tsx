import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import App from './App';

const useAuthMock = vi.fn();
const loginMock = vi.fn();

vi.mock('./AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useAuth: () => useAuthMock(),
}));

vi.mock('./pages/HomePage', () => ({ default: () => <div>HomePage Mock</div> }));
vi.mock('./pages/EnterWishPage', () => ({ default: () => <div>EnterWishPage Mock</div> }));
vi.mock('./pages/SearchPage', () => ({ default: () => <div>SearchPage Mock</div> }));
vi.mock('./pages/AboutPage', () => ({ default: () => <div>AboutPage Mock</div> }));
vi.mock('./pages/DisplayPage', () => ({
  default: ({ onEnterKiosk, isKiosk }: { onEnterKiosk: () => void; isKiosk: boolean }) => (
    <div>
      <div>DisplayPage Mock</div>
      <div>Is Kiosk: {isKiosk ? 'Yes' : 'No'}</div>
      <button onClick={onEnterKiosk}>Enter Kiosk</button>
    </div>
  ),
}));
vi.mock('./pages/AdminPage', () => ({ default: () => <div>AdminPage Mock</div> }));
vi.mock('./AccountPage', () => ({ default: () => <div>AccountPage Mock</div> }));

describe('App Component', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    loginMock.mockReset();
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: loginMock,
      logout: vi.fn(),
    });
    globalThis.window.location.hash = '#home';
  });

  it('renders navbar and navigates to different pages', async () => {
    render(<App />);

    expect(screen.getByText('HomePage Mock')).toBeInTheDocument();

    const searchTab = screen.getAllByText('Search Wishes')[0];
    fireEvent.click(searchTab);

    expect(screen.getByText('SearchPage Mock')).toBeInTheDocument();

    const aboutTab = screen.getAllByText('About')[0];
    fireEvent.click(aboutTab);

    expect(screen.getByText('AboutPage Mock')).toBeInTheDocument();
  });

  it('enters kiosk mode and hides header navigation', async () => {
    render(<App />);

    const displayTab = screen.getAllByText('Big Screen')[0];
    fireEvent.click(displayTab);

    expect(screen.getByText('DisplayPage Mock')).toBeInTheDocument();
    expect(screen.getByText('Is Kiosk: No')).toBeInTheDocument();

    const enterKioskBtn = screen.getByText('Enter Kiosk');
    fireEvent.click(enterKioskBtn);

    expect(screen.getByText('Is Kiosk: Yes')).toBeInTheDocument();
    expect(screen.queryByText('Big Screen')).not.toBeInTheDocument();
  });

  it('enters kiosk mode automatically when ?kiosk=true parameter is present in hash', async () => {
    globalThis.window.location.hash = '#display?kiosk=true';
    render(<App />);

    expect(screen.getByText('DisplayPage Mock')).toBeInTheDocument();
    expect(screen.getByText('Is Kiosk: Yes')).toBeInTheDocument();
    expect(screen.queryByText('Big Screen')).not.toBeInTheDocument();
  });

  it('enters kiosk mode automatically when ?kiosk=true parameter is present in search query', async () => {
    globalThis.window.history.replaceState({}, '', '?kiosk=true#display');

    render(<App />);

    expect(screen.getByText('DisplayPage Mock')).toBeInTheDocument();
    expect(screen.getByText('Is Kiosk: Yes')).toBeInTheDocument();
    expect(screen.queryByText('Big Screen')).not.toBeInTheDocument();

    // Clean up
    globalThis.window.history.replaceState({}, '', '/');
  });

  it('shows credentials modal on Escape key press in kiosk mode and allows exit for admin user', async () => {
    loginMock.mockResolvedValue({ success: true, role: 'admin' });

    render(<App />);

    // Go to big screen and enter kiosk mode
    fireEvent.click(screen.getAllByText('Big Screen')[0]);
    fireEvent.click(screen.getByText('Enter Kiosk'));

    // Trigger escape key
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(screen.getByText('Exit Kiosk Mode')).toBeInTheDocument();

    // Fill credentials
    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByText('Confirm Exit'));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin', 'secret');
      expect(screen.queryByText('Exit Kiosk Mode')).not.toBeInTheDocument();
      expect(screen.getAllByText('Big Screen')[0]).toBeInTheDocument(); // Navbar restored
    });
  });

  it('shows error on credentials failure or non-admin exit attempt', async () => {
    loginMock.mockResolvedValue({ success: true, role: 'user' });

    render(<App />);

    fireEvent.click(screen.getAllByText('Big Screen')[0]);
    fireEvent.click(screen.getByText('Enter Kiosk'));
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('e.g. admin'), { target: { value: 'user' } });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByText('Confirm Exit'));

    await waitFor(() => {
      expect(
        screen.getByText('Access denied: You must be an admin to exit kiosk mode.')
      ).toBeInTheDocument();
    });

    // Test cancel button
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Exit Kiosk Mode')).not.toBeInTheDocument();
  });

  it('does not render an Admin button in the navigation bar', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /^admin$/i })).not.toBeInTheDocument();
  });

  it('navigates directly to admin page via #admin hash without navbar button', async () => {
    globalThis.window.location.hash = '#admin';
    render(<App />);
    expect(screen.getByText('AdminPage Mock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^admin$/i })).not.toBeInTheDocument();
  });
});

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { extractUrl } from '../../../tests/testUtils';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

const useAuthMock = vi.fn();
const useExcludedWishesMock = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('./hooks/useExcludedWishes', () => ({
  useExcludedWishes: () => useExcludedWishesMock(),
}));

import AccountPage from './AccountPage';

describe('AccountPage', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useExcludedWishesMock.mockReset();
    useExcludedWishesMock.mockReturnValue({
      excludedIds: [],
      excludeWish: vi.fn(),
      unexcludeWish: vi.fn(),
      loading: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => {
        const url = extractUrl(input as RequestInfo | URL);
        if (url.includes('/api/users/exists')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders saved user identity attributes on the profile page', async () => {
    const refreshUser = vi.fn();
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
        role: 'user',
        attributes: {
          gender: ['woman'],
          orientation: ['queer'],
          role: ['speaker'],
        },
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    );

    render(<AccountPage />);

    expect(screen.getByText('Welcome back, tester')).toBeInTheDocument();
    expect(screen.getByText('Genders:')).toBeInTheDocument();
    expect(screen.getAllByText('woman')[0]).toBeInTheDocument();
    expect(screen.getByText('Orientations:')).toBeInTheDocument();
    expect(screen.getAllByText('queer')[0]).toBeInTheDocument();
    expect(screen.getByText('Roles:')).toBeInTheDocument();
    expect(screen.getAllByText('speaker')[0]).toBeInTheDocument();

    await screen.findByText('No wishes yet. Submit a new wish from the Enter a Wish page.');
  });

  it('submits register when in register mode with blank passphrase', async () => {
    const register = vi.fn().mockResolvedValue({ success: true, secret: 'auto-generated-secret' });
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    const registerButtons = screen.getAllByText('Register');
    const registerTabButton = registerButtons.find(
      (button) => button.getAttribute('type') !== 'submit'
    );
    const registerSubmitButton = registerButtons.find(
      (button) => button.getAttribute('type') === 'submit'
    );
    if (!registerTabButton || !registerSubmitButton) {
      throw new Error('Could not find register tab or submit button');
    }

    fireEvent.click(registerTabButton);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
    fireEvent.click(registerSubmitButton);

    expect(register).toHaveBeenCalledWith('newuser', undefined, {});
    await screen.findByText(/Account created. Remember your passphrase:/);
  });

  it('shows a generated passphrase tip in register mode', async () => {
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);
    const registerTabButton = screen
      .getAllByText('Register')
      .find((button) => button.getAttribute('type') !== 'submit');
    if (!registerTabButton) {
      throw new Error('Could not find register tab button');
    }

    fireEvent.click(registerTabButton);
    expect(await screen.findByText(/Tip: Use a memorable passphrase like/)).toBeInTheDocument();
  });

  it('auto-switches to login once the username already exists', async () => {
    const login = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Invalid username or passphrase.' });
    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/exists')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'existinguser' } });

    await waitFor(
      () => {
        const submitButtons = screen.getAllByRole('button');
        const submitButton = submitButtons.find(
          (button) => button.getAttribute('type') === 'submit'
        );
        expect(submitButton).toBeDefined();
        expect(submitButton).toHaveTextContent('Login');
      },
      { timeout: 3000 }
    );
  });

  it('submits login when in login mode with provided passphrase', async () => {
    const login = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Invalid username or passphrase.' });
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    const loginTabButton = screen.getByRole('button', { name: 'Login' });
    fireEvent.click(loginTabButton);

    const loginSubmitButton = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');
    if (!loginSubmitButton) {
      throw new Error('Could not find login submit button');
    }

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'newpass' } });
    fireEvent.click(loginSubmitButton);

    expect(login).toHaveBeenCalledWith('newuser', 'newpass');
    await screen.findByText('Invalid username or passphrase.');
  });

  it('lets logged-in users edit and save profile attributes', async () => {
    const refreshUser = vi.fn();
    const fetchMock = vi.fn((input, init) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url === '/api/users/me' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              attributes: {
                gender: ['woman'],
                orientation: ['queer'],
                role: ['speaker'],
              },
            }),
        });
      }
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/users/exists')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
        role: 'user',
        attributes: {
          gender: ['woman'],
          orientation: ['queer'],
          role: ['speaker'],
        },
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser,
    });

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText('Genders'), { target: { value: 'woman' } });
    fireEvent.change(screen.getByLabelText('Orientations'), { target: { value: 'queer' } });
    fireEvent.change(screen.getByLabelText('Roles'), { target: { value: 'speaker' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save attributes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PUT' })
      )
    );
    expect(refreshUser).toHaveBeenCalled();
  });

  it('renders Edit Wish link and allows user to delete a wish', async () => {
    const fetchMock = vi.fn((input, _init) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'wish-1', content: 'test wish', flagged: 0 }]),
        });
      }
      if (url.includes('/api/wishes/wish-1/manage')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    expect(await screen.findByText('test wish')).toBeInTheDocument();

    // Check Edit button
    const editButton = screen.getByRole('button', { name: 'Edit Wish' });
    fireEvent.click(editButton);
    expect(globalThis.location.hash).toBe('#manage-wish?id=wish-1');

    const deleteButton = screen.getByRole('button', { name: 'Delete Wish' });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishes/wish-1/manage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'delete' }),
        })
      );
    });
  });

  it('shows error if registration fields are missing', async () => {
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    render(<AccountPage />);
    const submit = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');
    fireEvent.click(submit!);
    expect(await screen.findByText('Username is required to register.')).toBeInTheDocument();
  });

  it('shows error if login fields are missing', async () => {
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    const submit = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');
    fireEvent.click(submit!);
    expect(
      await screen.findByText('Username and passphrase are required to log in.')
    ).toBeInTheDocument();
  });

  it('shows error if deleting a wish fails', async () => {
    const fetchMock = vi.fn((input, _init) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'wish-3', content: 'test', flagged: 0 }]),
        });
      }
      if (url.includes('/api/wishes/wish-3/manage')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Delete failed' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);
    const deleteButton = await screen.findByRole('button', { name: 'Delete Wish' });
    fireEvent.click(deleteButton);
    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
  });

  it('allows user to type into identity fields during registration', async () => {
    const register = vi.fn().mockResolvedValue({ success: true, secret: 'secret' });
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    render(<AccountPage />);

    // In register mode by default
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/Identity Genders/i), { target: { value: 'man' } });
    fireEvent.change(screen.getByLabelText(/Identity Orientations/i), { target: { value: 'gay' } });
    fireEvent.change(screen.getByLabelText(/Identity Roles/i), { target: { value: 'top' } });

    const submit = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');
    fireEvent.click(submit!);

    expect(register).toHaveBeenCalledWith('testuser', undefined, {
      gender: 'man',
      orientation: 'gay',
      role: 'top',
    });
    await screen.findByText(/Account created. Remember your passphrase: secret/);
  });

  it('allows user to delete their account and handles cancellation', async () => {
    const logout = vi.fn();
    const fetchMock = vi.fn((input, init) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/me/delete-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ wishesCount: 2, wishmailsCount: 1 }),
        });
      }
      if (url.includes('/api/users/me/delete') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout,
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    // Click delete account
    const deleteBtn = screen.getByRole('button', { name: 'Delete Account' });
    fireEvent.click(deleteBtn);

    // Modal appears
    await waitFor(() =>
      expect(screen.getByText(/This action is permanent and cannot be undone/)).toBeInTheDocument()
    );

    // Cancel modal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByText(/This action is permanent and cannot be undone/)
      ).not.toBeInTheDocument()
    );

    // Click delete account again
    fireEvent.click(deleteBtn);
    await waitFor(() =>
      expect(screen.getByText(/This action is permanent and cannot be undone/)).toBeInTheDocument()
    );

    // Confirm deletion
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete Account' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/me/delete'),
        expect.objectContaining({ method: 'POST' })
      )
    );
    expect(logout).toHaveBeenCalled();
  });

  it('shows error if account delete preview fails', async () => {
    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/me/delete-preview')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'failed' }) });
      }
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-test',
        username: 'tester',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
    await waitFor(() =>
      expect(screen.getByText('Unable to fetch delete preview.')).toBeInTheDocument()
    );
  });

  it('handles network errors gracefully when checking username existence', async () => {
    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/exists')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'erroruser' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      const submitButtons = screen.getAllByRole('button');
      const submitButton = submitButtons.find((button) => button.getAttribute('type') === 'submit');
      expect(submitButton).toBeDefined();
      expect(submitButton).toHaveTextContent('Register');
    });
  });

  it('allows user to claim a wish and handles errors', async () => {
    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/wishes/invalid-wish/claim')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Invalid passphrase' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    const claimIdInput = screen.getByLabelText(/Wish ID/i);
    const claimSecretInput = screen.getByLabelText(/Passphrase/i);

    // Test missing fields
    fireEvent.click(screen.getByRole('button', { name: 'Claim Wish' }));
    expect(
      await screen.findByText('Wish ID and Passphrase are required to claim a wish.')
    ).toBeInTheDocument();

    // Test error
    fireEvent.change(claimIdInput, { target: { value: 'invalid-wish' } });
    fireEvent.change(claimSecretInput, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Wish' }));
    expect(await screen.findByText('Invalid passphrase')).toBeInTheDocument();
  });

  it('allows user to claim a wish and handles success', async () => {
    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/wishes/valid-wish/claim')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    const claimIdInput = screen.getByLabelText(/Wish ID/i);
    const claimSecretInput = screen.getByLabelText(/Passphrase/i);

    fireEvent.change(claimIdInput, { target: { value: 'valid-wish' } });
    fireEvent.change(claimSecretInput, { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Wish' }));

    expect(await screen.findByText('Wish claimed successfully!')).toBeInTheDocument();
  });

  it('allows logged in user to un-hide a wish and fetches updated list', async () => {
    const unexcludeWishSpy = vi.fn();
    useExcludedWishesMock.mockReturnValue({
      excludedIds: ['wish-id-123'],
      excludeWish: vi.fn(),
      unexcludeWish: unexcludeWishSpy,
      loading: false,
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/wishes/exclusions') && !url.includes('/list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'wish-id-123', content: 'hidden wish' }]),
        });
      }
      if (url.includes('/api/users/me/wishes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/wishes/wish-id-123/exclude')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    // Click the in-card 👁 unhide button (ExcludeToggleButton)
    const unhideBtn = await screen.findByRole('button', { name: 'Unhide wish' });
    fireEvent.click(unhideBtn);

    // Verify it sent a DELETE request to /api/wishes/wish-id-123/exclude
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishes/wish-id-123/exclude',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    expect(await screen.findByText('Wish is now visible again.')).toBeInTheDocument();
  });

  it('allows guest to un-hide a wish using hook', async () => {
    const unexcludeWishSpy = vi.fn().mockResolvedValue(undefined);
    useExcludedWishesMock.mockReturnValue({
      excludedIds: ['wish-id-123'],
      excludeWish: vi.fn(),
      unexcludeWish: unexcludeWishSpy,
      loading: false,
    });

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/exists')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false }) });
      }
      if (url.includes('/api/wishes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'wish-id-123', content: 'local wish' }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    // In guest view, click the in-card 👁 unhide button
    const unhideBtn = await screen.findByRole('button', { name: 'Unhide wish' });
    fireEvent.click(unhideBtn);

    expect(unexcludeWishSpy).toHaveBeenCalledWith('wish-id-123');
    expect(await screen.findByText('Wish is now visible again.')).toBeInTheDocument();
  });

  it('allows user to toggle profile status (deactivate/reactivate)', async () => {
    const refreshUserSpy = vi.fn();
    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
        is_active: true,
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: refreshUserSpy,
    });

    const fetchMock = vi.fn((input) => {
      const url = extractUrl(input as RequestInfo | URL);
      if (url.includes('/api/users/me/deactivate')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    const toggleBtn = screen.getByRole('button', { name: 'Deactivate Profile' });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me/deactivate',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
    expect(refreshUserSpy).toHaveBeenCalled();
    expect(await screen.findByText('Profile deactivated successfully.')).toBeInTheDocument();
  });

  it('allows user to manage contact methods', async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
        contacts: [{ type: 'FetLife', value: 'myhandle' }],
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    // Change contact value
    const input = screen.getByPlaceholderText('Username, number, etc.');
    fireEvent.change(input, { target: { value: 'newhandle' } });
    expect(input).toHaveValue('newhandle');

    // Change contact type
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Email' } });
    expect(select).toHaveValue('Email');

    // Add contact method
    const addBtn = screen.getByRole('button', { name: '+ Add Contact Method' });
    fireEvent.click(addBtn);
    const inputs = screen.getAllByPlaceholderText('Username, number, etc.');
    expect(inputs).toHaveLength(2);

    // Delete contact method
    const deleteBtns = screen.getAllByRole('button', { name: 'X' });
    fireEvent.click(deleteBtns[0]);
    const remainingInputs = screen.getAllByPlaceholderText('Username, number, etc.');
    expect(remainingInputs).toHaveLength(1);
  });

  it('allows toggling default wishmail checkbox', async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        username: 'user1',
        role: 'user',
        wishmail_enabled: false,
      },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    const checkbox = screen.getByLabelText('Enable Wishmail by default');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('validates blank fields, handles errors, and succeeds when claiming an anonymous wish', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user' },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    // 1. Submit blank claim form -> validation error
    const claimButton = screen.getByRole('button', { name: 'Claim Wish' });
    fireEvent.click(claimButton);
    expect(
      screen.getByText('Wish ID and Passphrase are required to claim a wish.')
    ).toBeInTheDocument();

    // 2. Submit with ID and passphrase where API fails -> error message
    const wishIdInput = screen.getByPlaceholderText('e.g. abc123xy');
    const passphraseInput = screen.getByPlaceholderText('e.g. CorrectHorseBatteryStaple');

    fireEvent.change(wishIdInput, { target: { value: 'claim-123' } });
    fireEvent.change(passphraseInput, { target: { value: 'wrong-secret' } });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/claim')) {
          return {
            ok: false,
            json: async () => ({ error: 'Invalid passphrase for this wish.' }),
          };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(claimButton);
    await waitFor(() => {
      expect(screen.getByText('Invalid passphrase for this wish.')).toBeInTheDocument();
    });

    // 3. Submit with valid credentials -> success message
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/claim')) {
          return {
            ok: true,
            json: async () => ({ success: true }),
          };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(claimButton);
    await waitFor(() => {
      expect(screen.getByText('Wish claimed successfully!')).toBeInTheDocument();
    });
  });

  it('handles login and registration validation errors and success messages', async () => {
    const login = vi.fn();
    const register = vi.fn();
    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login,
      register,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    // 1. Submit login with missing fields
    const loginTabButton = screen.getByRole('button', { name: 'Login' });
    fireEvent.click(loginTabButton);
    const loginSubmitButton = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');
    if (!loginSubmitButton) throw new Error('No login submit button');

    fireEvent.click(loginSubmitButton);
    expect(screen.getByText('Username and passphrase are required to log in.')).toBeInTheDocument();

    // 2. Submit login with valid fields -> success
    login.mockResolvedValueOnce({ success: true });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'validuser' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'validpass' } });
    fireEvent.click(loginSubmitButton);

    await waitFor(() => {
      expect(screen.getByText('Logged in successfully.')).toBeInTheDocument();
    });

    // 3. Submit register with blank username -> error
    const registerTabButton = screen
      .getAllByRole('button')
      .find(
        (button) => button.textContent === 'Register' && button.getAttribute('type') !== 'submit'
      );
    if (!registerTabButton) throw new Error('No register tab');
    fireEvent.click(registerTabButton);

    const registerSubmitButton = screen
      .getAllByRole('button')
      .find(
        (button) => button.textContent === 'Register' && button.getAttribute('type') === 'submit'
      );
    if (!registerSubmitButton) throw new Error('No register submit button');

    fireEvent.click(registerSubmitButton);
    expect(screen.getByText('Username is required to register.')).toBeInTheDocument();

    // 4. Submit register failing API -> error message
    register.mockResolvedValueOnce({ success: false, error: 'Username already taken.' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'takenuser' } });
    fireEvent.click(registerSubmitButton);

    await waitFor(() => {
      expect(screen.getByText('Username already taken.')).toBeInTheDocument();
    });
  });

  it('handles save profile success and error responses', async () => {
    const refreshUser = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user', attributes: {} },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser,
    });

    render(<AccountPage />);

    const saveButton = screen.getByRole('button', { name: 'Save attributes' });

    // 1. API error handling
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/api/users/me')) {
          return {
            ok: false,
            json: async () => ({ error: 'Failed to update profile attributes.' }),
          };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText('Failed to update profile attributes.')).toBeInTheDocument();
    });

    // 2. Success handling
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/api/users/me')) {
          return {
            ok: true,
            json: async () => ({ success: true }),
          };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText('Profile updated successfully.')).toBeInTheDocument();
      expect(refreshUser).toHaveBeenCalled();
    });
  });

  it('allows deactivating and reactivating user profile status', async () => {
    const refreshUser = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user', is_active: true },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser,
    });

    // 1. Deactivate profile success
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/deactivate')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    const { rerender } = render(<AccountPage />);

    const deactivateBtn = screen.getByRole('button', { name: 'Deactivate Profile' });
    fireEvent.click(deactivateBtn);

    await waitFor(() => {
      expect(screen.getByText('Profile deactivated successfully.')).toBeInTheDocument();
      expect(refreshUser).toHaveBeenCalled();
    });

    // 2. Reactivate profile for inactive user
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user', is_active: false },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/reactivate')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    rerender(<AccountPage />);

    expect(screen.getByText('Inactive')).toBeInTheDocument();
    const reactivateBtn = screen.getByRole('button', { name: 'Reactivate Profile' });
    fireEvent.click(reactivateBtn);

    await waitFor(() => {
      expect(screen.getByText('Profile reactivated successfully.')).toBeInTheDocument();
    });
  });

  it('handles account deletion flow and error scenarios', async () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user', is_active: true },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout,
      refreshUser: vi.fn(),
    });

    // 1. Delete preview API failure
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/delete-preview')) {
          return { ok: false, json: async () => ({ error: 'Preview failed' }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    render(<AccountPage />);
    const deleteAccountBtn = screen.getByRole('button', { name: 'Delete Account' });
    fireEvent.click(deleteAccountBtn);

    await waitFor(() => {
      expect(screen.getByText('Unable to fetch delete preview.')).toBeInTheDocument();
    });

    // 2. Delete preview success -> open modal -> confirm delete -> failure
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/delete-preview')) {
          return { ok: true, json: async () => ({ wishesCount: 2, wishmailsCount: 1 }) };
        }
        if (url.includes('/delete')) {
          return { ok: false, json: async () => ({ error: 'Delete failed' }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(deleteAccountBtn);

    const confirmModalBtn = await screen.findByRole('button', { name: 'Yes, Delete Account' });
    fireEvent.click(confirmModalBtn);

    await waitFor(() => {
      expect(screen.getByText('Unable to delete account.')).toBeInTheDocument();
    });

    // 3. Confirm delete success -> calls logout
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/delete-preview')) {
          return { ok: true, json: async () => ({ wishesCount: 2, wishmailsCount: 1 }) };
        }
        if (url.includes('/delete')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    fireEvent.click(deleteAccountBtn);
    const confirmBtnSuccess = await screen.findByRole('button', { name: 'Yes, Delete Account' });
    fireEvent.click(confirmBtnSuccess);

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
  });

  it('handles user wish deletion and unhide wish operations', async () => {
    const unexcludeWish = vi.fn().mockResolvedValue(undefined);
    useExcludedWishesMock.mockReturnValue({
      excludedIds: ['wish-hidden-1'],
      excludeWish: vi.fn(),
      unexcludeWish,
      loading: false,
    });

    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user' },
      token: 'fake-token',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = extractUrl(input);
        if (url.includes('/me/wishes')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 'wish-1',
                content: 'Test Wish 1',
                flagged: 0,
                contacts: [],
                wishmail_enabled: true,
                is_active: true,
              },
            ],
          };
        }
        if (url.includes('/exclusions')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 'wish-hidden-1',
                content: 'Hidden Wish 1',
                flagged: 0,
                contacts: [],
                wishmail_enabled: false,
                is_active: true,
              },
            ],
          };
        }
        if (url.includes('/manage')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        if (url.includes('/exclude')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => [] };
      })
    );

    render(<AccountPage />);

    expect(await screen.findByText('Test Wish 1')).toBeInTheDocument();
    expect(await screen.findByText('Hidden Wish 1')).toBeInTheDocument();

    // Delete wish success
    const deleteWishBtn = screen.getByRole('button', { name: 'Delete Wish' });
    fireEvent.click(deleteWishBtn);

    await waitFor(() => {
      expect(screen.getByText('Wish deleted successfully.')).toBeInTheDocument();
    });

    // Unhide wish success
    const unhideBtn = screen.getByRole('button', { name: 'Unhide wish' });
    fireEvent.click(unhideBtn);

    await waitFor(() => {
      expect(screen.getByText('Wish is now visible again.')).toBeInTheDocument();
    });
  });

  it('renders easy mobile login QR code and link when authenticated with token', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', username: 'user1', role: 'user' },
      token: 'mobile-auth-token-123',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<AccountPage />);

    expect(await screen.findByText('Easy Mobile Login')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bookmark this auto-login link' })).toHaveAttribute(
      'href',
      '#account?token=mobile-auth-token-123'
    );
  });
});

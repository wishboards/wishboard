import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const TestComponent = () => {
  const { user, token, login, register, logout, refreshUser } = useAuth();
  return (
    <div>
      <div data-testid="user">{user ? user.username : 'no-user'}</div>
      <div data-testid="role">{user ? user.role : 'no-role'}</div>
      <div data-testid="token">{token || 'no-token'}</div>
      <button onClick={() => login('testuser', 'pass')} data-testid="login-btn">
        Login
      </button>
      <button
        onClick={() =>
          register('testuser', 'pass', { identity_attributes: { gender: ['female'] } })
        }
        data-testid="register-btn"
      >
        Register
      </button>
      <button onClick={logout} data-testid="logout-btn">
        Logout
      </button>
      <button onClick={refreshUser} data-testid="refresh-btn">
        Refresh
      </button>
    </div>
  );
};

const FailureComponent = () => {
  useAuth();
  return <div>Fail</div>;
};

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Dynamic fetch mock router to handle background calls and login/register cleanly
    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      if (url === '/api/users/me') {
        const authHeader = options?.headers?.Authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (token && token !== 'invalid-token' && token !== 'no-token') {
          let username = 'mockuser';
          let role = 'user';
          if (token === 'new-token') {
            username = 'testuser';
            role = 'admin';
          } else if (token === 'reg-token') {
            username = 'testuser';
            role = 'user';
          }
          return {
            ok: true,
            json: async () => ({
              id: '123',
              username,
              role,
            }),
          };
        }
        return { ok: false };
      }

      if (url === '/api/users/login') {
        const body = JSON.parse(options.body);
        if (body.username === 'testuser' && body.passphrase === 'pass') {
          return {
            ok: true,
            json: async () => ({
              token: 'new-token',
              id: '456',
              username: 'testuser',
              role: 'admin',
            }),
          };
        }
        return {
          ok: false,
          json: async () => ({ error: 'Invalid credentials' }),
        };
      }

      if (url === '/api/users/register') {
        const body = JSON.parse(options.body);
        if (body.username === 'testuser') {
          return {
            ok: true,
            json: async () => ({
              token: 'reg-token',
              id: '789',
              username: 'testuser',
              role: 'user',
              secret: 'secret-passphrase',
            }),
          };
        }
        return {
          ok: false,
          json: async () => ({ error: 'Username taken' }),
        };
      }

      return { ok: false };
    });
  });

  it('throws error when useAuth is used outside of AuthProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<FailureComponent />)).toThrow('useAuth must be used within AuthProvider');
    consoleError.mockRestore();
  });

  it('provides default values without a token', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('user').textContent).toBe('no-user');
    expect(screen.getByTestId('token').textContent).toBe('no-token');
  });

  it('restores token and fetches user info from localStorage on mount', async () => {
    localStorage.setItem('wishboard-auth-token', 'mock-token-123');

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('token').textContent).toBe('mock-token-123');
    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('mockuser');
    });
  });

  it('handles refreshUser failure by clearing credentials', async () => {
    localStorage.setItem('wishboard-auth-token', 'invalid-token');

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('token').textContent).toBe('no-token');
    });
    expect(screen.getByTestId('user').textContent).toBe('no-user');
    expect(localStorage.getItem('wishboard-auth-token')).toBeNull();
  });

  it('performs login successfully', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    const loginBtn = screen.getByTestId('login-btn');
    await act(async () => {
      loginBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('token').textContent).toBe('new-token');
    });
    expect(screen.getByTestId('user').textContent).toBe('testuser');
    expect(screen.getByTestId('role').textContent).toBe('admin');
    expect(localStorage.getItem('wishboard-auth-token')).toBe('new-token');
  });

  it('handles login failure gracefully', async () => {
    let res;
    const GrabberComponent = () => {
      const { login } = useAuth();
      const trigger = async () => {
        res = await login('baduser', 'badpass');
      };
      return (
        <button onClick={trigger} data-testid="trigger">
          Trigger
        </button>
      );
    };

    render(
      <AuthProvider>
        <GrabberComponent />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByTestId('trigger').click();
    });

    expect(res).toEqual({ success: false, error: 'Invalid credentials' });
  });

  it('performs registration successfully', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    const registerBtn = screen.getByTestId('register-btn');
    await act(async () => {
      registerBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('token').textContent).toBe('reg-token');
    });
    expect(screen.getByTestId('user').textContent).toBe('testuser');
    expect(localStorage.getItem('wishboard-auth-token')).toBe('reg-token');
  });

  it('handles registration failure gracefully', async () => {
    let res;
    const GrabberComponent = () => {
      const { register } = useAuth();
      const trigger = async () => {
        res = await register('baduser', 'pass');
      };
      return (
        <button onClick={trigger} data-testid="trigger">
          Trigger
        </button>
      );
    };

    render(
      <AuthProvider>
        <GrabberComponent />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByTestId('trigger').click();
    });

    expect(res).toEqual({ success: false, error: 'Username taken' });
  });

  it('logs out and clears storage', async () => {
    localStorage.setItem('wishboard-auth-token', 'mock-token-123');

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('mockuser');
    });

    const logoutBtn = screen.getByTestId('logout-btn');
    await act(async () => {
      logoutBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('token').textContent).toBe('no-token');
    });
    expect(screen.getByTestId('user').textContent).toBe('no-user');
    expect(localStorage.getItem('wishboard-auth-token')).toBeNull();
  });
  it('sets token externally', async () => {
    let contextValue: any;
    const GrabberComponent = () => {
      contextValue = useAuth();
      return null;
    };

    render(
      <AuthProvider>
        <GrabberComponent />
      </AuthProvider>
    );

    await act(async () => {
      contextValue.setTokenExternally('external-token');
    });

    expect(contextValue.token).toBe('external-token');
    expect(localStorage.getItem('wishboard-auth-token')).toBe('external-token');
  });

  it('migrates local storage excluded wishes on login and register', async () => {
    localStorage.setItem('wishboard_excluded_wishes', JSON.stringify(['w1', 'w2']));
    const postMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      if (url === '/api/users/login') {
        return {
          ok: true,
          json: async () => ({ token: 'new-token', role: 'user', id: '123', username: 'testuser' }),
        };
      }
      if (url === '/api/users/register') {
        return {
          ok: true,
          json: async () => ({
            token: 'reg-token',
            role: 'user',
            id: '456',
            username: 'reguser',
            secret: 'sec',
          }),
        };
      }
      if (url === '/api/wishes/exclusions/import') {
        return postMock(JSON.parse(options?.body || '{}'));
      }
      return { ok: true, json: async () => ({}) };
    });

    let contextValue: any;
    const Grabber = () => {
      contextValue = useAuth();
      return null;
    };

    render(
      <AuthProvider>
        <Grabber />
      </AuthProvider>
    );

    await act(async () => {
      await contextValue.login('testuser', 'secret');
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith({ ids: ['w1', 'w2'] });

    await act(async () => {
      await contextValue.register('reguser', 'secret');
    });

    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('handles non-array or empty excluded wishes during migration on login', async () => {
    localStorage.setItem('wishboard_excluded_wishes', JSON.stringify('not-an-array'));
    const postMock = vi.fn();
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/users/login') {
        return {
          ok: true,
          json: async () => ({ token: 't1', role: 'user', id: '1', username: 'u1' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    let contextValue: any;
    const Grabber = () => {
      contextValue = useAuth();
      return null;
    };

    render(
      <AuthProvider>
        <Grabber />
      </AuthProvider>
    );

    await act(async () => {
      await contextValue.login('u1', 'p1');
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  it('handles network errors during local storage exclusion migration gracefully', async () => {
    localStorage.setItem('wishboard_excluded_wishes', JSON.stringify(['w1']));
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/users/login') {
        return {
          ok: true,
          json: async () => ({ token: 't1', role: 'user', id: '1', username: 'u1' }),
        };
      }
      if (url === '/api/wishes/exclusions/import') {
        throw new Error('Network failure');
      }
      return { ok: true, json: async () => ({}) };
    });

    let contextValue: any;
    const Grabber = () => {
      contextValue = useAuth();
      return null;
    };

    render(
      <AuthProvider>
        <Grabber />
      </AuthProvider>
    );

    await act(async () => {
      const res = await contextValue.login('u1', 'p1');
      expect(res.success).toBe(true);
    });
  });

  it('returns custom error message when login or register response is not ok', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/users/login' || url === '/api/users/register') {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: false };
    });

    let contextValue: any;
    const Grabber = () => {
      contextValue = useAuth();
      return null;
    };

    render(
      <AuthProvider>
        <Grabber />
      </AuthProvider>
    );

    await act(async () => {
      const loginRes = await contextValue.login('u1', 'p1');
      expect(loginRes.error).toBe('Login failed.');

      const regRes = await contextValue.register('u2', 'p2');
      expect(regRes.error).toBe('Registration failed.');
    });
  });

  it('handles corrupted wishboard_excluded_wishes gracefully during migration', async () => {
    localStorage.setItem('wishboard_excluded_wishes', 'invalid-json{');
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    expect(screen.getByTestId('user').textContent).toBe('no-user');
  });

  it('maps user attributes correctly when identity_attributes and non-string types are provided', async () => {
    localStorage.setItem('wishboard-auth-token', 'token-alt');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 999,
        username: 'numuser',
        role: null,
        identity_attributes: { gender: ['nonbinary'] },
        contacts: [{ type: 'email', value: 'a@b.com' }],
        wishmail_enabled: 1,
        is_active: 0,
      }),
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('numuser');
      expect(screen.getByTestId('role').textContent).toBe('user');
    });
  });
});

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  ReactNode,
} from 'react';

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  attributes: Record<string, string[]>;
  contacts: { type: string; value: string }[];
  wishmail_enabled: boolean;
  is_active: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  login: (
    username: string,
    passphrase: string
  ) => Promise<{ success: boolean; error?: string; role?: string }>;
  register: (
    username: string,
    passphrase?: string,
    identityAttributes?: Record<string, string>,
    contacts?: { type: string; value: string }[],
    wishmailEnabled?: boolean
  ) => Promise<{ success: boolean; error?: string; secret?: string; role?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setTokenExternally: (newToken: string) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const storageKey = 'wishboard-auth-token';

const parseStringOrNumber = (val: unknown, fallback = ''): string => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return fallback;
};

const mapToAuthUser = (data: Record<string, unknown>): AuthUser => ({
  id: parseStringOrNumber(data.id),
  username: parseStringOrNumber(data.username),
  role: typeof data.role === 'string' ? data.role : 'user',
  attributes: (data.attributes || data.identity_attributes || {}) as Record<string, string[]>,
  contacts: (data.contacts || []) as { type: string; value: string }[],
  wishmail_enabled: Boolean(data.wishmail_enabled),
  is_active: data.is_active === undefined ? true : Boolean(data.is_active),
});

const migrateLocalStorageExclusions = async (token: string) => {
  const localRaw = localStorage.getItem('wishboard_excluded_wishes'); // NOSONAR
  if (!localRaw) return;
  try {
    const localIds: string[] = JSON.parse(localRaw);
    if (!Array.isArray(localIds) || localIds.length === 0) return;
    for (const wishId of localIds) {
      await fetch('/api/users/me/exclusions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ wish_id: wishId }),
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Failed to migrate local storage exclusions:', err);
  }
};

function useRefreshUser({
  token,
  setToken,
  setUser,
}: {
  token: string | null;
  setToken: React.Dispatch<React.SetStateAction<string | null>>;
  setUser: React.Dispatch<React.SetStateAction<AuthUser | null>>;
}) {
  const refreshUser = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }

    const response = await fetch('/api/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      localStorage.removeItem(storageKey); // NOSONAR
      setToken(null);
      setUser(null);
      return;
    }

    const data = await response.json();
    setUser(mapToAuthUser(data));
  }, [token, setToken, setUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return { refreshUser };
}

function useAuthOperations({
  setToken,
  setUser,
}: {
  setToken: React.Dispatch<React.SetStateAction<string | null>>;
  setUser: React.Dispatch<React.SetStateAction<AuthUser | null>>;
}) {
  const login = useCallback(
    async (username: string, passphrase: string) => {
      const response = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passphrase }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error || 'Login failed.' };
      }

      setToken(data.token);
      localStorage.setItem(storageKey, data.token); // NOSONAR
      setUser(mapToAuthUser(data));
      await migrateLocalStorageExclusions(data.token);
      return { success: true, role: data.role };
    },
    [setToken, setUser]
  );

  const register = useCallback(
    async (
      username: string,
      passphrase?: string,
      identityAttributes?: Record<string, string>,
      contacts?: { type: string; value: string }[],
      wishmailEnabled?: boolean
    ) => {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          passphrase,
          identity_attributes: identityAttributes,
          contacts,
          wishmail_enabled: wishmailEnabled,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error || 'Registration failed.' };
      }

      setToken(data.token);
      localStorage.setItem(storageKey, data.token); // NOSONAR
      setUser(mapToAuthUser(data));
      await migrateLocalStorageExclusions(data.token);
      return { success: true, secret: data.secret, role: data.role };
    },
    [setToken, setUser]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(storageKey); // NOSONAR
    setToken(null);
    setUser(null);
  }, [setToken, setUser]);

  const setTokenExternally = useCallback(
    (newToken: string) => {
      setToken(newToken);
      localStorage.setItem(storageKey, newToken); // NOSONAR
    },
    [setToken]
  );

  return { login, register, logout, setTokenExternally };
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  // @refresh reset
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(storageKey)); // NOSONAR
  const [user, setUser] = useState<AuthUser | null>(null);

  const { refreshUser } = useRefreshUser({ token, setToken, setUser });
  const { login, register, logout, setTokenExternally } = useAuthOperations({
    setToken,
    setUser,
  });

  const value = useMemo(
    () => ({ user, token, login, register, logout, refreshUser, setTokenExternally }),
    [user, token, login, register, logout, refreshUser, setTokenExternally]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Context hook export co-located with provider per idiomatic React pattern
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

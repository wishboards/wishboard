import React, {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useCallback,
  ReactNode,
} from 'react';

export type ThemeMode = 'host-default' | 'midnight' | 'daylight' | 'corkhouse' | 'high-contrast';

export interface UIPreferences {
  themeMode?: ThemeMode;
  defaultCardColor?: string;
  defaultPinColor?: string;
}

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  attributes: Record<string, string[]>;
  contacts: { type: string; value: string }[];
  wishmail_enabled: boolean;
  is_active: boolean;
  ui_preferences?: UIPreferences;
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
  ui_preferences: (data.ui_preferences as UIPreferences) || { themeMode: 'host-default' },
});

const syncLocalStoragePreferences = async (token: string, remotePrefs?: UIPreferences) => {
  const localRaw = globalThis.localStorage?.getItem('wishboard_ui_preferences');
  if (!localRaw) {
    if (remotePrefs) {
      globalThis.localStorage?.setItem('wishboard_ui_preferences', JSON.stringify(remotePrefs));
    }
    return;
  }
  try {
    const localPrefs = JSON.parse(localRaw) as UIPreferences;
    if (
      localPrefs?.themeMode &&
      localPrefs.themeMode !== 'host-default' &&
      (!remotePrefs || remotePrefs.themeMode === 'host-default')
    ) {
      await fetch('/api/users/me', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ui_preferences: localPrefs }),
      });
    } else if (remotePrefs) {
      globalThis.localStorage?.setItem('wishboard_ui_preferences', JSON.stringify(remotePrefs));
    }
  } catch (err) {
    console.warn('Failed to sync local storage UI preferences:', err);
  }
};

const migrateLocalStorageExclusions = async (token: string) => {
  const localRaw = globalThis.localStorage?.getItem('wishboard_excluded_wishes'); // NOSONAR
  if (!localRaw) return;
  try {
    const localIds: string[] = JSON.parse(localRaw);
    if (!Array.isArray(localIds) || localIds.length === 0) return;
    await fetch('/api/wishes/exclusions/import', {
      // NOSONAR
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: localIds }),
    });
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
      globalThis.localStorage?.removeItem(storageKey); // NOSONAR
      setToken(null);
      setUser(null);
      return;
    }

    const data = await response.json();
    setUser(mapToAuthUser(data));
  }, [token, setToken, setUser]);

  useEffect(() => {
    void refreshUser();
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
      globalThis.localStorage?.setItem(storageKey, data.token); // NOSONAR
      setUser(mapToAuthUser(data));
      await migrateLocalStorageExclusions(data.token);
      await syncLocalStoragePreferences(data.token, data.ui_preferences);
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
      let localPrefs: UIPreferences | undefined;
      const localRaw = globalThis.localStorage?.getItem('wishboard_ui_preferences');
      if (localRaw) {
        try {
          localPrefs = JSON.parse(localRaw) as UIPreferences;
        } catch {
          // ignore invalid json
        }
      }

      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          passphrase,
          identity_attributes: identityAttributes,
          contacts,
          wishmail_enabled: wishmailEnabled,
          ...(localPrefs ? { ui_preferences: localPrefs } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error || 'Registration failed.' };
      }

      setToken(data.token);
      globalThis.localStorage?.setItem(storageKey, data.token); // NOSONAR
      setUser(mapToAuthUser(data));
      await migrateLocalStorageExclusions(data.token);
      await syncLocalStoragePreferences(data.token, data.ui_preferences);
      return { success: true, secret: data.secret, role: data.role };
    },
    [setToken, setUser]
  );

  const logout = useCallback(() => {
    globalThis.localStorage?.removeItem(storageKey); // NOSONAR
    setToken(null);
    setUser(null);
  }, [setToken, setUser]);

  const setTokenExternally = useCallback(
    (newToken: string) => {
      setToken(newToken);
      globalThis.localStorage?.setItem(storageKey, newToken); // NOSONAR
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

  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Context hook export co-located with provider per idiomatic React pattern
export const useAuth = () => {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

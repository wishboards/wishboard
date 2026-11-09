import { useCallback, useEffect, useState } from 'react';
import { useAuth, ThemeMode, UIPreferences } from '../AuthContext';
import { useEventProfile, ThemePreset } from '../EventProfileContext';

export const STORAGE_PREFERENCES_KEY = 'wishboard_ui_preferences';

const VALID_THEMES: ThemeMode[] = [
  'host-default',
  'midnight',
  'daylight',
  'corkhouse',
  'high-contrast',
];

export const getStoredPreferences = (): UIPreferences => {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
    return { themeMode: 'host-default' };
  }
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_PREFERENCES_KEY);
    if (!raw) return { themeMode: 'host-default' };
    const parsed = JSON.parse(raw) as UIPreferences;
    return parsed && typeof parsed === 'object' ? parsed : { themeMode: 'host-default' };
  } catch {
    return { themeMode: 'host-default' };
  }
};

export const setStoredPreferences = (prefs: UIPreferences): void => {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
    return;
  }
  try {
    globalThis.localStorage.setItem(STORAGE_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Failed to store UI preferences in localStorage:', err);
  }
};

export function useTheme() {
  const { user, token, refreshUser } = useAuth();
  const { branding } = useEventProfile();

  const [selectedThemeMode, setSelectedThemeMode] = useState<ThemeMode | null>(null);

  const themeMode: ThemeMode =
    selectedThemeMode ||
    user?.ui_preferences?.themeMode ||
    getStoredPreferences().themeMode ||
    'host-default';

  const hostPreset: ThemePreset = branding?.themePreset || 'midnight';
  const effectiveTheme: ThemePreset =
    themeMode === 'host-default' ? hostPreset : (themeMode as ThemePreset);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    if (branding?.accentColor && themeMode === 'host-default') {
      document.documentElement.style.setProperty('--wb-accent-primary', branding.accentColor);
    } else {
      document.documentElement.style.removeProperty('--wb-accent-primary');
    }
  }, [effectiveTheme, branding?.accentColor, themeMode]);

  const setThemeMode = useCallback(
    async (newTheme: ThemeMode) => {
      if (!VALID_THEMES.includes(newTheme)) return;

      const currentPrefs: UIPreferences = user?.ui_preferences || getStoredPreferences();
      const updatedPrefs: UIPreferences = { ...currentPrefs, themeMode: newTheme };

      setSelectedThemeMode(newTheme);
      setStoredPreferences(updatedPrefs);

      if (token) {
        try {
          await fetch('/api/users/me', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ ui_preferences: updatedPrefs }),
          });
          if (refreshUser) {
            await refreshUser();
          }
        } catch (err) {
          console.error('Failed to persist UI preferences:', err);
        }
      }
    },
    [user, token, refreshUser]
  );

  return {
    themeMode,
    effectiveTheme,
    setThemeMode,
  };
}

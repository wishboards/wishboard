import { useCallback, useEffect, useState } from 'react';
import { useAuth, ThemeMode, UIPreferences } from '../AuthContext';
import { useEventProfile, ThemePreset, BoardTexture, BrandingConfig } from '../EventProfileContext';
import { getSocket } from './useWebSocket';

export const STORAGE_PREFERENCES_KEY = 'wishboard_ui_preferences';

const VALID_THEMES: ReadonlySet<ThemeMode> = new Set([
  'host-default',
  'midnight',
  'daylight',
  'corkhouse',
  'high-contrast',
]);

export function resolveBoardTextureCss(texture?: BoardTexture, bgUrl?: string | null): string {
  if (bgUrl) return `url('${bgUrl}')`;
  switch (texture) {
    case 'cork':
      return "url('/textures/cork.webp')";
    case 'slate':
      return "url('/textures/slate.webp')";
    case 'linen':
      return "url('/textures/linen.webp')";
    case 'custom':
      return bgUrl ? `url('${bgUrl}')` : 'none';
    case 'none':
      return 'none';
    default:
      return "url('/textures/cork.webp')";
  }
}

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

function setOrRemoveCssVar(name: string, value?: string | null) {
  if (value) {
    document.documentElement.style.setProperty(name, value);
  } else {
    document.documentElement.style.removeProperty(name);
  }
}

export function useTheme() {
  const { user, token, refreshUser } = useAuth();
  const { branding: profileBranding } = useEventProfile();

  const [liveBranding, setLiveBranding] = useState<BrandingConfig | null>(null);
  const [selectedThemeMode, setSelectedThemeMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const handleBranding = (updated: BrandingConfig) => {
      if (updated && typeof updated === 'object') {
        setLiveBranding(updated);
      }
    };

    socket.on('sys:branding', handleBranding);
    return () => {
      socket.off('sys:branding', handleBranding);
    };
  }, []);

  const branding: BrandingConfig = liveBranding || profileBranding || {};

  const themeMode: ThemeMode =
    selectedThemeMode ||
    user?.ui_preferences?.themeMode ||
    getStoredPreferences().themeMode ||
    'host-default';

  const hostPreset: ThemePreset = branding.themePreset || 'midnight';
  const effectiveTheme: ThemePreset =
    themeMode === 'host-default' ? hostPreset : (themeMode as ThemePreset);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.boardTexture = branding.boardTexture || 'cork';

    const isHostDefault = themeMode === 'host-default';
    setOrRemoveCssVar('--wb-accent-primary', isHostDefault ? branding.accentColor : null);
    setOrRemoveCssVar(
      '--wb-accent-hover',
      isHostDefault ? branding.primaryColor || branding.accentColor : null
    );
    setOrRemoveCssVar('--wb-bg-surface', isHostDefault ? branding.surfaceColor : null);
    setOrRemoveCssVar(
      '--wb-brand-logo-url',
      branding.logoUrl ? `url('${branding.logoUrl}')` : null
    );

    const textureCss = resolveBoardTextureCss(branding.boardTexture, branding.boardBgUrl);
    document.documentElement.style.setProperty('--wb-board-texture', textureCss);
    setOrRemoveCssVar(
      '--wb-board-bg-url',
      branding.boardBgUrl ? `url('${branding.boardBgUrl}')` : null
    );
  }, [
    effectiveTheme,
    branding.accentColor,
    branding.primaryColor,
    branding.surfaceColor,
    branding.boardTexture,
    branding.logoUrl,
    branding.boardBgUrl,
    themeMode,
  ]);

  const setThemeMode = useCallback(
    async (newTheme: ThemeMode) => {
      if (!VALID_THEMES.has(newTheme)) return;

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
    branding,
  };
}

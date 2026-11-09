import { useState, useEffect } from 'react';

/**
 * Custom hook to observe a CSS media query string.
 * Uses globalThis.matchMedia and handles fallback for non-DOM/SSR environments.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function') {
      return globalThis.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof globalThis === 'undefined' || typeof globalThis.matchMedia !== 'function') {
      return;
    }

    const mql = globalThis.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
    } else if ('addListener' in mql) {
      (mql as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(
        onChange
      );
    }

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange);
      } else if ('removeListener' in mql) {
        (mql as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener(
          onChange
        );
      }
    };
  }, [query]);

  return matches;
}

/**
 * Convenience hook for handheld companion viewports (< 768px).
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../AuthContext';

const LOCAL_STORAGE_KEY = 'wishboard.excludedWishes';

function getInitialLocalExclusions(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) {
        return ids;
      }
    }
  } catch (err) {
    console.error('Failed to load wish exclusions from localStorage:', err);
  }
  return [];
}

export function useExcludedWishes() {
  const { token, user } = useAuth();
  const isAuthenticated = Boolean(token && user);
  const [prevAuthenticated, setPrevAuthenticated] = useState(isAuthenticated);

  const [excludedIds, setExcludedIds] = useState<string[]>(() => {
    if (!token || !user) {
      return getInitialLocalExclusions();
    }
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => Boolean(token && user));

  if (isAuthenticated !== prevAuthenticated) {
    setPrevAuthenticated(isAuthenticated);
    if (!isAuthenticated) {
      setExcludedIds(getInitialLocalExclusions());
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  // Load initial exclusions
  useEffect(() => {
    if (!token || !user) {
      return;
    }
    let active = true;

    async function loadServerExclusions() {
      try {
        const res = await fetch('/api/wishes/exclusions/list', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok && active) {
          const data = await res.json();
          setExcludedIds(data);
        }
      } catch (err) {
        console.error('Failed to load wish exclusions from server:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadServerExclusions();

    return () => {
      active = false;
    };
  }, [token, user]);

  // Exclude/Hide a wish
  const excludeWish = useCallback(
    async (wishId: string) => {
      // Optimistic update
      setExcludedIds((prev) => {
        if (prev.includes(wishId)) return prev;
        const next = [...prev, wishId];
        if (!token) {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });

      if (token) {
        try {
          const res = await fetch(`/api/wishes/${wishId}/exclude`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (!res.ok) {
            // Revert on failure
            setExcludedIds((prev) => prev.filter((id) => id !== wishId));
          }
        } catch (err) {
          console.error('Failed to exclude wish on server:', err);
          setExcludedIds((prev) => prev.filter((id) => id !== wishId));
        }
      }
    },
    [token]
  );

  // Un-exclude/Un-hide a wish
  const unexcludeWish = useCallback(
    async (wishId: string) => {
      // Optimistic update
      setExcludedIds((prev) => {
        const next = prev.filter((id) => id !== wishId);
        if (!token) {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });

      if (token) {
        try {
          const res = await fetch(`/api/wishes/${wishId}/exclude`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (!res.ok) {
            // Revert on failure
            setExcludedIds((prev) => {
              if (prev.includes(wishId)) return prev;
              return [...prev, wishId];
            });
          }
        } catch (err) {
          console.error('Failed to remove wish exclusion on server:', err);
          setExcludedIds((prev) => {
            if (prev.includes(wishId)) return prev;
            return [...prev, wishId];
          });
        }
      }
    },
    [token]
  );

  const isExcluded = useCallback((wishId: string) => excludedIds.includes(wishId), [excludedIds]);

  return {
    excludedIds,
    excludeWish,
    unexcludeWish,
    isExcluded,
    loading,
  };
}

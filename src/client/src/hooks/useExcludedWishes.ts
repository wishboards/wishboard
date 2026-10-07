import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../AuthContext';

const LOCAL_STORAGE_KEY = 'wishboard.excludedWishes';

export function useExcludedWishes() {
  const { token, user } = useAuth();
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Load initial exclusions
  useEffect(() => {
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

    function loadLocalExclusions() {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw && active) {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) {
            setExcludedIds(ids);
          }
        }
      } catch (err) {
        console.error('Failed to load wish exclusions from localStorage:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (token && user) {
      void loadServerExclusions();
    } else {
      void loadLocalExclusions();
    }

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

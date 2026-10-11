import React from 'react';

export function useMetricsFetcher<T>(
  url: string,
  authHeader: Record<string, string>,
  refreshMs: number
) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: authHeader });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error fetching metrics.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [url, authHeader]);

  React.useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  React.useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        void fetchMetrics();
      }, refreshMs);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchMetrics, refreshMs]);

  return { data, loading, error, autoRefresh, setAutoRefresh, fetchMetrics };
}

export default useMetricsFetcher;

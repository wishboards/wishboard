/**
 * LocalMetricsDashboard
 *
 * Renders live in-process server metrics for local/Docker deployments.
 * Fetches from GET /api/admin/local-metrics (backed by metricsCollector.js).
 *
 * Shares the same visual design as AwsMetricsDashboard — Recharts sparklines,
 * dark colour palette, stat-card + chart layout.
 *
 * Metrics shown:
 *   - CPU usage %
 *   - Heap used / heap total (MB)
 *   - RSS memory (MB)
 *   - OS load average (1-min)
 *   - HTTP request counts by status class (2xx / 4xx / 5xx)
 *   - Mean response time (ms)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  GradDef,
  CustomTooltip as ChartTooltip,
  MetricCard,
  NoData,
  SectionTitle,
  Grid,
  MetricsToolbar,
} from './DashboardShared';
import { formatShortTime, TICK_STYLE, COLORS as C } from './DashboardSharedUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OsSample {
  ts: number;
  cpu: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  load: number;
}

interface HttpSample {
  ts: number;
  r2xx: number;
  r3xx: number;
  r4xx: number;
  r5xx: number;
  count: number;
  mean: number;
}

interface LocalMetricsResponse {
  osSamples: OsSample[];
  httpSamples: HttpSample[];
  intervalMs: number;
  generatedAt: string;
}

// ── OS Metric Cards ───────────────────────────────────────────────────────────

const CpuCard = ({ samples }: { samples: OsSample[] }) => {
  const latest = samples.at(-1)?.cpu ?? 0;
  return (
    <MetricCard title="CPU Usage" headline={`${latest.toFixed(1)}%`} headlineNote="current">
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id="grad-cpu" color={C.blue} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={[0, 100]} />
            <Tooltip content={<ChartTooltip unit="%" />} />
            <Area
              type="monotone"
              dataKey="cpu"
              stroke={C.blue.stroke}
              strokeWidth={1.5}
              fill="url(#grad-cpu)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

const HeapCard = ({ samples }: { samples: OsSample[] }) => {
  const latest = samples.at(-1);
  const usedPct = latest ? Math.round((latest.heapUsed / latest.heapTotal) * 100) : 0;
  return (
    <MetricCard
      title="Heap Usage"
      headline={`${latest?.heapUsed.toFixed(0) ?? 0} MB`}
      headlineNote={`${usedPct}% of ${latest?.heapTotal.toFixed(0) ?? 0} MB limit`}
    >
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id="grad-heap" color={C.purple} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip unit=" MB" />} />
            <Area
              type="monotone"
              dataKey="heapUsed"
              name="Heap Used"
              stroke={C.purple.stroke}
              strokeWidth={1.5}
              fill="url(#grad-heap)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

const RssCard = ({ samples }: { samples: OsSample[] }) => {
  const latest = samples.at(-1)?.rss ?? 0;
  return (
    <MetricCard
      title="RSS Memory"
      headline={`${latest.toFixed(0)} MB`}
      headlineNote="resident set size"
    >
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id="grad-rss" color={C.pink} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip unit=" MB" />} />
            <Area
              type="monotone"
              dataKey="rss"
              stroke={C.pink.stroke}
              strokeWidth={1.5}
              fill="url(#grad-rss)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

const LoadCard = ({ samples }: { samples: OsSample[] }) => {
  const latest = samples.at(-1)?.load ?? 0;
  return (
    <MetricCard title="Load Average" headline={latest.toFixed(2)} headlineNote="1-min">
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id="grad-load" color={C.teal} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="load"
              stroke={C.teal.stroke}
              strokeWidth={1.5}
              fill="url(#grad-load)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

// ── HTTP Metric Cards ─────────────────────────────────────────────────────────

const RequestRateCard = ({ samples }: { samples: HttpSample[] }) => {
  // Sum 2xx+3xx over last 10 samples for a "recent" feel
  const recent = samples.slice(-10);
  const total = recent.reduce((s, p) => s + p.r2xx + p.r3xx, 0);
  return (
    <MetricCard title="Successful Requests" headline={String(total)} headlineNote="last 50s">
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id="grad-req" color={C.green} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="r2xx"
              name="2xx"
              stroke={C.green.stroke}
              strokeWidth={1.5}
              fill="url(#grad-req)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

const ErrorRateCard = ({ samples }: { samples: HttpSample[] }) => {
  const recent = samples.slice(-10);
  const total4xx = recent.reduce((s, p) => s + p.r4xx, 0);
  const total5xx = recent.reduce((s, p) => s + p.r5xx, 0);
  return (
    <MetricCard
      title="Error Responses"
      headline={String(total4xx + total5xx)}
      headlineNote="last 50s"
    >
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <LineChart data={samples} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="r4xx"
              name="4xx"
              stroke={C.orange.stroke}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="r5xx"
              name="5xx"
              stroke={C.red.stroke}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

const LatencyCard = ({ samples }: { samples: HttpSample[] }) => {
  // Weighted mean of the last 12 samples (≈1 min)
  const window = samples.slice(-12).filter((s) => s.count > 0);
  const totalCount = window.reduce((s, p) => s + p.count, 0);
  const weightedMean =
    totalCount > 0 ? window.reduce((s, p) => s + p.mean * p.count, 0) / totalCount : 0;

  return (
    <MetricCard
      title="Mean Response Time"
      headline={`${weightedMean.toFixed(1)} ms`}
      headlineNote="last 60s"
    >
      {samples.length > 1 ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart
            data={samples.filter((s) => s.count > 0)}
            margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
          >
            <GradDef id="grad-lat" color={C.purple} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatShortTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip unit=" ms" />} />
            <Area
              type="monotone"
              dataKey="mean"
              name="Mean"
              stroke={C.purple.stroke}
              strokeWidth={1.5}
              fill="url(#grad-lat)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData />
      )}
    </MetricCard>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 10_000; // 10s — matches 2× the 5s sample interval

interface LocalMetricsDashboardProps {
  authHeader: Record<string, string>;
}

function useLocalMetrics(authHeader: Record<string, string>) {
  const [data, setData] = useState<LocalMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/local-metrics', { headers: authHeader });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchMetrics, AUTO_REFRESH_MS);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchMetrics]);

  return {
    data,
    loading,
    error,
    autoRefresh,
    setAutoRefresh,
    fetchMetrics,
  };
}

export default function LocalMetricsDashboard({
  authHeader,
}: Readonly<LocalMetricsDashboardProps>) {
  const { data, loading, error, autoRefresh, setAutoRefresh, fetchMetrics } =
    useLocalMetrics(authHeader);

  return (
    <div style={{ color: '#e5e7eb' }}>
      <MetricsToolbar
        loading={loading}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        fetchMetrics={fetchMetrics}
        generatedAt={data?.generatedAt}
        refreshIntervalLabel="10s"
      />

      {error && (
        <div
          style={{
            background: '#1c0a0a',
            border: '1px solid #7f1d1d',
            borderRadius: '6px',
            padding: '12px 16px',
            color: '#fca5a5',
            fontSize: '13px',
            marginBottom: '16px',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
          Loading metrics…
        </div>
      )}

      {data && (
        <>
          <SectionTitle>Process &amp; System</SectionTitle>
          <Grid>
            <CpuCard samples={data.osSamples} />
            <HeapCard samples={data.osSamples} />
            <RssCard samples={data.osSamples} />
            <LoadCard samples={data.osSamples} />
          </Grid>

          <SectionTitle>HTTP Traffic</SectionTitle>
          <Grid>
            <RequestRateCard samples={data.httpSamples} />
            <ErrorRateCard samples={data.httpSamples} />
            <LatencyCard samples={data.httpSamples} />
          </Grid>
        </>
      )}

      <p style={{ fontSize: '11px', color: '#374151', marginTop: '4px' }}>
        Sampled every {data ? data.intervalMs / 1000 : 5}s. Up to 60 minutes of history retained.
      </p>
    </div>
  );
}

/**
 * AwsMetricsDashboard
 *
 * Renders live CloudWatch metrics for the Wishboard serverless deployment.
 * Fetches data from GET /api/admin/aws-metrics, which is only active when
 * running in AWS Lambda mode. Displays time-series sparkline charts grouped
 * by AWS service (Lambda, API Gateway, CloudFront).
 *
 * Auto-refreshes every 30 seconds by default.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  GradDef,
  CustomTooltip,
  MetricCard,
  NoData,
  SectionTitle,
  Grid,
  MetricsToolbar,
} from './DashboardShared';
import {
  formatTime,
  formatValue,
  COLORS,
  TICK_STYLE,
  type MetricGroup,
  type MetricSeries,
  type DataPoint,
} from './DashboardSharedUtils';

interface AwsMetricsResponse {
  groups: MetricGroup[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a "current value" (latest non-zero, or last value) for the stat badge */
const currentValue = (dataPoints: DataPoint[]): number => {
  if (!dataPoints.length) return 0;
  for (let i = dataPoints.length - 1; i >= 0; i--) {
    if (dataPoints[i].v !== 0) return dataPoints[i].v;
  }
  return dataPoints.at(-1)!.v;
};

/** Sum of all values — used for invocation/error counts */
const sumValues = (dataPoints: DataPoint[]): number => dataPoints.reduce((acc, p) => acc + p.v, 0);

/** Determine if a metric is a counter (Sum stat) vs a gauge (Average/p99/Maximum) */
const isCounter = (label: string): boolean =>
  label.toLowerCase().includes('invocation') ||
  label.toLowerCase().includes('error') ||
  label.toLowerCase().includes('throttle') ||
  label.toLowerCase().includes('request') ||
  label.toLowerCase().includes('bytes') ||
  label.toLowerCase().includes('count') ||
  label.toLowerCase().includes('messages');

const colorForMetric = (id: string) => {
  if (id.includes('error') || id.includes('4xx') || id.includes('5xx')) return COLORS.error;
  if (id.includes('throttle')) return COLORS.throttle;
  if (id.includes('duration') || id.includes('latency')) return COLORS.duration;
  if (id.includes('concurrent')) return COLORS.concurrent;
  if (id.includes('cache')) return COLORS.cache;
  if (id.includes('bytes')) return COLORS.bytes;
  return COLORS.default;
};

// ── Sparkline Card ─────────────────────────────────────────────────────────────

interface SparklineCardProps {
  metric: MetricSeries;
}

const SparklineCard: React.FC<SparklineCardProps> = ({ metric }) => {
  const { id, label, dataPoints } = metric;
  const color = colorForMetric(id);
  const hasData = dataPoints.some((p) => p.v > 0);

  // For counters show the total over the period; for gauges show the latest
  const headline = isCounter(label)
    ? formatValue(sumValues(dataPoints), label)
    : formatValue(currentValue(dataPoints), label);

  const headlineNote = isCounter(label) ? 'last hour total' : 'latest';

  return (
    <MetricCard title={label} headline={headline} headlineNote={headlineNote}>
      {hasData ? (
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={dataPoints} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <GradDef id={`grad-${id}`} color={color} />
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={formatTime}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip metricLabel={label} />} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color.stroke}
              strokeWidth={1.5}
              fill={`url(#grad-${id})`}
              dot={false}
              activeDot={{ r: 3, fill: color.stroke }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <NoData text="No data in this period" />
      )}
    </MetricCard>
  );
};

// ── Metric Group Section ───────────────────────────────────────────────────────

const MetricGroupSection: React.FC<{ group: MetricGroup }> = ({ group }) => (
  <div>
    <SectionTitle>{group.title}</SectionTitle>
    <Grid>
      {group.metrics.map((metric) => (
        <SparklineCard key={metric.id} metric={metric} />
      ))}
    </Grid>
  </div>
);

// ── Main Dashboard Component ───────────────────────────────────────────────────

const AUTO_REFRESH_MS = 30_000;

interface AwsMetricsDashboardProps {
  authHeader: Record<string, string>;
}

export default function AwsMetricsDashboard({ authHeader }: Readonly<AwsMetricsDashboardProps>) {
  const [data, setData] = useState<AwsMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/aws-metrics', { headers: authHeader });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setData(await response.json());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error fetching metrics.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Auto-refresh timer
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

  return (
    <div style={{ color: '#e5e7eb' }}>
      <MetricsToolbar
        loading={loading}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        fetchMetrics={fetchMetrics}
        generatedAt={data?.generatedAt}
        refreshIntervalLabel="30s"
      />

      {/* Error state */}
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
          {error.toLowerCase().includes('iam') ||
          error.toLowerCase().includes('access denied') ||
          error.toLowerCase().includes('not authorized') ? (
            <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: '12px' }}>
              The Lambda execution role needs <code>cloudwatch:GetMetricData</code> permission. See{' '}
              <code>aws-serverless/template.yaml</code> → <code>ApiFunction.Policies</code>.
            </p>
          ) : null}
        </div>
      )}

      {/* Skeleton / loading on first load */}
      {loading && !data && (
        <div style={{ color: '#6b7280', fontSize: '13px', padding: '24px 0' }}>
          Loading CloudWatch metrics…
        </div>
      )}

      {/* Metric groups */}
      {data?.groups?.map((group) => (
        <MetricGroupSection key={group.title} group={group} />
      ))}

      {/* Empty state after successful fetch */}
      {!loading && !error && data?.groups?.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: '13px' }}>
          No metrics returned. The Lambda may not have received traffic yet, or CloudWatch metrics
          may still be propagating (can take 1–3 minutes after first invocation).
        </p>
      )}

      <p style={{ fontSize: '11px', color: '#374151', marginTop: '12px' }}>
        Showing 1-minute resolution over the last 60 minutes. CloudFront metrics require additional
        configuration in the SAM template (<code>CLOUDFRONT_DISTRIBUTION_ID</code> env var).
      </p>
    </div>
  );
}

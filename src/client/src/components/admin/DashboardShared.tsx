/* eslint-disable react-refresh/only-export-components */
import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataPoint {
  /** ISO 8601 timestamp */
  t: string;
  /** Metric value */
  v: number;
}

export interface MetricSeries {
  id: string;
  label: string;
  dataPoints: DataPoint[];
}

export interface MetricGroup {
  title: string;
  metrics: MetricSeries[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format an ISO timestamp to HH:MM for axis labels */
export const formatTime = (isoString: string | number): string => {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: typeof isoString === 'number' ? '2-digit' : undefined,
      hour12: false,
    });
  } catch {
    return '';
  }
};

export const formatShortTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** Format a value with up to 1 decimal place, collapsing to integer when whole */
export const formatValue = (value: number, label: string): string => {
  if (label.toLowerCase().includes('bytes')) {
    if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(2)} GB`;
    if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`;
    if (value >= 1_024) return `${(value / 1_024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (label.includes('(ms)')) return `${Math.round(value)} ms`;
  if (label.includes('(%)')) return `${value.toFixed(1)}%`;
  if (value === 0) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
};

// ── Colour palette ─────────────────────────────────────────────────────────────

export const COLORS = {
  default: { stroke: '#60a5fa', fill: '#1d4ed8' }, // blue
  blue: { stroke: '#60a5fa', fill: '#1d4ed8' },
  error: { stroke: '#f87171', fill: '#991b1b' }, // red
  red: { stroke: '#f87171', fill: '#991b1b' },
  throttle: { stroke: '#fb923c', fill: '#92400e' }, // orange
  orange: { stroke: '#fb923c', fill: '#92400e' },
  duration: { stroke: '#a78bfa', fill: '#4c1d95' }, // purple
  latency: { stroke: '#a78bfa', fill: '#4c1d95' }, // purple
  purple: { stroke: '#a78bfa', fill: '#4c1d95' },
  concurrent: { stroke: '#34d399', fill: '#065f46' }, // green
  cache: { stroke: '#34d399', fill: '#065f46' }, // green
  green: { stroke: '#34d399', fill: '#065f46' },
  bytes: { stroke: '#e879f9', fill: '#701a75' }, // pink
  pink: { stroke: '#e879f9', fill: '#701a75' },
  teal: { stroke: '#2dd4bf', fill: '#134e4a' },
};

// Gradient defs
export const gradDef = (id: string, color: { stroke: string }) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor={color.stroke} stopOpacity={0.4} />
      <stop offset="95%" stopColor={color.stroke} stopOpacity={0} />
    </linearGradient>
  </defs>
);

// Shared XAxis tick style
export const TICK_STYLE = { fontSize: 9, fill: '#6b7280' };

// ── Custom Tooltips ────────────────────────────────────────────────────────────

export interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; color?: string }>;
  label?: string | number;
  metricLabel?: string;
  unit?: string;
}

export const CustomTooltip = ({
  active,
  payload,
  label: rawLabel,
  metricLabel,
  unit = '',
}: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  const isAwsFormat = metricLabel !== undefined;

  return (
    <div
      style={{
        background: '#1e1e2e',
        border: '1px solid #374151',
        borderRadius: '6px',
        padding: '8px 12px',
        fontSize: '12px',
        color: '#e5e7eb',
      }}
    >
      <div style={{ color: '#9ca3af', marginBottom: '4px' }}>
        {rawLabel === undefined ? '' : formatTime(rawLabel)}
      </div>
      {isAwsFormat ? (
        <div>
          <strong>{formatValue(payload[0]?.value ?? 0, metricLabel!)}</strong>
        </div>
      ) : (
        payload.map((p) => (
          <div key={p.name ?? p.color} style={{ color: p.color ?? '#e5e7eb' }}>
            {p.name && <span style={{ marginRight: 4 }}>{p.name}:</span>}
            <strong>{typeof p.value === 'number' ? `${p.value.toFixed(1)}${unit}` : '—'}</strong>
          </div>
        ))
      )}
    </div>
  );
};

// ── Cards ──────────────────────────────────────────────────────────────────────

export interface CardProps {
  title: string;
  headline: string;
  headlineNote?: string;
  children: React.ReactNode;
}

export const MetricCard = ({ title, headline, headlineNote, children }: CardProps) => (
  <div
    style={{
      background: '#111827',
      border: '1px solid #1f2937',
      borderRadius: '8px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
    }}
  >
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: '4px',
      }}
    >
      <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500, lineHeight: 1.3 }}>
        {title}
      </span>
      <div style={{ textAlign: 'right' }}>
        <span
          style={{ fontSize: '20px', fontWeight: 700, color: '#f9fafb', letterSpacing: '-0.5px' }}
        >
          {headline}
        </span>
        {headlineNote && (
          <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '4px' }}>
            {headlineNote}
          </span>
        )}
      </div>
    </div>
    {children}
  </div>
);

export const NoData = ({ text = 'Collecting…' }: { text?: string }) => (
  <div
    style={{
      height: 70,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#374151',
      fontSize: '12px',
    }}
  >
    {text}
  </div>
);

// ── Section headers ───────────────────────────────────────────────────────────

export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3
    style={{
      margin: '0 0 12px',
      fontSize: '14px',
      color: '#d1d5db',
      fontWeight: 600,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
    }}
  >
    {children}
  </h3>
);

export const Grid = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: '12px',
      marginBottom: '28px',
    }}
  >
    {children}
  </div>
);

// ── Metrics Toolbar ───────────────────────────────────────────────────────────

export interface MetricsToolbarProps {
  loading: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  fetchMetrics: () => void;
  generatedAt?: string;
  refreshIntervalLabel: string;
}

export const MetricsToolbar = ({
  loading,
  autoRefresh,
  setAutoRefresh,
  fetchMetrics,
  generatedAt,
  refreshIntervalLabel,
}: MetricsToolbarProps) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '20px',
      flexWrap: 'wrap',
    }}
  >
    <button type="button" className="secondary-button" onClick={fetchMetrics} disabled={loading}>
      {loading ? '⟳ Refreshing…' : '⟳ Refresh Now'}
    </button>
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        color: '#9ca3af',
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={autoRefresh}
        onChange={(e) => setAutoRefresh(e.target.checked)}
      />
      <span>Auto-refresh every {refreshIntervalLabel}</span>
    </label>
    {generatedAt && (
      <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#6b7280' }}>
        Last updated:{' '}
        {new Date(generatedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}
      </span>
    )}
  </div>
);

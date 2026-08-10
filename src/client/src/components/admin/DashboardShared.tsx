/* eslint-disable react-refresh/only-export-components */

import React from 'react';
import { formatTime, formatValue } from './DashboardUtils';

// Gradient defs
export const GradDef = ({ id, color }: { id: string; color: { stroke: string } }) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor={color.stroke} stopOpacity={0.4} />
      <stop offset="95%" stopColor={color.stroke} stopOpacity={0} />
    </linearGradient>
  </defs>
);

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

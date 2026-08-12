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

export const TICK_STYLE = { fontSize: 9, fill: '#6b7280' };

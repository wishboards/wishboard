/**
 * AwsMetricsDashboard.test.tsx
 *
 * Coverage targets (lines from SonarQube):
 *  - formatTime lines 52-56: valid ISO string + catch-fallback empty string
 *  - formatValue lines 61-71: bytes GB/MB/KB/B, (ms), (%), integer, 0, decimal
 *  - currentValue lines 76-80: last non-zero, all-zero fallback, empty
 *  - isCounter line 89: invocation/error/throttle/request/bytes/count/messages
 *  - colorForMetric lines 111-117: error/4xx/5xx, throttle, duration/latency,
 *    concurrent, cache, bytes, default
 *  - CustomTooltip lines 129-144: active=true renders; active=false returns null
 *  - Main component lines 130-132, 141, 204: loading, error/IAM-hint, empty groups
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import AwsMetricsDashboard from './AwsMetricsDashboard';

// ── Recharts stub — avoids SVG / ResizeObserver errors in jsdom ───────────────
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: any) => {
    // Support both function render-props and JSX element (Recharts cloneElement API)
    const props = { active: true, payload: [{ value: 42 }], label: '2024-01-01T12:00:00Z' };
    // eslint-disable-next-line @eslint-react/no-clone-element
    const el = typeof content === 'function' ? content(props) : React.cloneElement(content, props);
    return el ?? null;
  },
}));

// ── Mock useWebSocket (pulled in by transitive deps via SystemOverviewSection) -
vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH = { Authorization: 'Basic dGVzdA==' };

const pt = (t: string, v: number) => ({ t, v });
const series = (id: string, label: string, points: { t: string; v: number }[]) => ({
  id,
  label,
  dataPoints: points,
});
const group = (title: string, metrics: any[]) => ({ title, metrics });
const response = (groups: any[], generatedAt = '2024-06-01T15:30:45Z') => ({ groups, generatedAt });

function mockOk(body: object) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as any);
}

function mockHttpError(status: number, body: object = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as any);
}

function mockNetworkError(message: string) {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(message));
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('AwsMetricsDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Loading state (line 344-346 in source) ─────────────────────────────────
  it('shows loading skeleton on first fetch before data arrives', async () => {
    let resolveIt: (v: any) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolveIt = r;
      })
    );

    render(<AwsMetricsDashboard authHeader={AUTH} />);
    expect(screen.getByText(/Loading CloudWatch metrics/i)).toBeInTheDocument();

    await act(async () => {
      resolveIt!({ ok: true, json: () => Promise.resolve(response([])) });
    });
  });

  // ── Empty groups (lines 354-358) ───────────────────────────────────────────
  it('shows empty-state message when groups array is empty after fetch', async () => {
    mockOk(response([]));
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/No metrics returned/i)).toBeInTheDocument();
  });

  // ── "Last updated" timestamp (line 316-320) ────────────────────────────────
  it('displays last-updated timestamp from generatedAt field', async () => {
    mockOk(response([]));
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Last updated/i)).toBeInTheDocument();
  });

  // ── Metric groups render ───────────────────────────────────────────────────
  it('renders group section titles for each metric group', async () => {
    const data = response([
      group('Lambda', [series('invocations', 'Invocations', [pt('2024-01-01T12:00:00Z', 10)])]),
      group('API Gateway', [series('requests', 'Requests', [pt('2024-01-01T12:00:00Z', 5)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Lambda')).toBeInTheDocument();
    expect(screen.getByText('API Gateway')).toBeInTheDocument();
  });

  // ── Generic HTTP error (lines 323-340) ─────────────────────────────────────
  it('shows generic error message on non-ok HTTP response', async () => {
    mockHttpError(503, { error: 'Service Unavailable' });
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Service Unavailable/i)).toBeInTheDocument();
  });

  it('falls back to HTTP status code when error body is empty', async () => {
    mockHttpError(500, {});
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
  });

  it('shows generic network error message on fetch rejection', async () => {
    mockNetworkError('Failed to fetch');
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });

  // ── IAM hint (lines 335-339) ───────────────────────────────────────────────
  it('shows IAM hint when error contains "access denied"', async () => {
    mockHttpError(403, { error: 'Access Denied: IAM policy missing' });
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/cloudwatch:GetMetricData/i)).toBeInTheDocument();
  });

  it('shows IAM hint when error contains "not authorized"', async () => {
    mockNetworkError('User is not authorized to perform this action');
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/cloudwatch:GetMetricData/i)).toBeInTheDocument();
  });

  it('shows IAM hint when error contains "iam"', async () => {
    mockNetworkError('IAM role missing cloudwatch permission');
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/cloudwatch:GetMetricData/i)).toBeInTheDocument();
  });

  // ── Refresh button ─────────────────────────────────────────────────────────
  it('triggers another fetch when Refresh Now is clicked', async () => {
    mockOk(response([]));
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });

    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(response([])) } as any);
    globalThis.fetch = spy;

    await act(async () => {
      fireEvent.click(screen.getByText(/Refresh Now/i));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // ── Auto-refresh toggle (lines 282-292) ───────────────────────────────────
  it('clears the timer when auto-refresh is unchecked', async () => {
    mockOk(response([]));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('fires an additional fetch after 30 seconds when auto-refresh is on', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(response([])) } as any);
    globalThis.fetch = spy;
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });

    const callsAfterMount = spy.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  // ── SparklineCard — no data fallback (lines 217-220) ──────────────────────
  it('shows "No data in this period" when all data points are zero', async () => {
    const data = response([
      group('Lambda', [series('invocations', 'Invocations', [pt('2024-01-01T12:00:00Z', 0)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/No data in this period/i)).toBeInTheDocument();
  });

  it('renders chart (no "No data") when at least one point is non-zero', async () => {
    const data = response([
      group('Lambda', [
        series('duration', 'Duration (ms)', [
          pt('2024-01-01T12:00:00Z', 0),
          pt('2024-01-01T12:01:00Z', 150),
        ]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.queryByText(/No data in this period/i)).not.toBeInTheDocument();
  });

  // ── formatValue — bytes branches (lines 62-65) ────────────────────────────
  it('formatValue: renders 1 MB for 1048576 bytes (counter sum)', async () => {
    const data = response([
      group('CF', [series('bytes', 'Bytes Downloaded', [pt('2024-01-01T12:00:00Z', 1_048_576)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('formatValue: renders GB for values >= 1 GiB', async () => {
    const data = response([
      group('CF', [
        series('bytes', 'Bytes Downloaded', [pt('2024-01-01T12:00:00Z', 2_147_483_648)]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('2.00 GB')).toBeInTheDocument();
  });

  it('formatValue: renders KB for values >= 1024 and < 1 MiB', async () => {
    const data = response([
      group('CF', [series('bytes', 'Bytes Downloaded', [pt('2024-01-01T12:00:00Z', 2048)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('formatValue: renders raw B for values < 1024', async () => {
    const data = response([
      group('CF', [series('bytes', 'Bytes Downloaded', [pt('2024-01-01T12:00:00Z', 512)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('512 B')).toBeInTheDocument();
  });

  // ── formatValue — non-bytes branches (lines 67-71) ────────────────────────
  it('formatValue: renders ms suffix for (ms) label', async () => {
    const data = response([
      group('Lambda', [series('duration', 'Duration (ms)', [pt('2024-01-01T12:00:00Z', 250)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('250 ms')).toBeInTheDocument();
  });

  it('formatValue: renders % suffix for (%) label', async () => {
    const data = response([
      group('CF', [series('cache', 'Cache Hit Rate (%)', [pt('2024-01-01T12:00:00Z', 98.5)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('98.5%')).toBeInTheDocument();
  });

  it('formatValue: renders "0" for zero value on gauge metric', async () => {
    const data = response([
      group('Lambda', [
        series('concurrent', 'Concurrent Executions', [pt('2024-01-01T12:00:00Z', 0)]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('formatValue: renders integer string without decimal for whole numbers', async () => {
    const data = response([
      group('Lambda', [
        series('concurrent', 'Concurrent Executions', [pt('2024-01-01T12:00:00Z', 7)]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('formatValue: renders one-decimal float for non-integer gauge', async () => {
    // id "latency_p99" not a counter → headline = currentValue → 3.5
    // label does NOT contain "(ms)" or "(%)," so → value.toFixed(1) = "3.5"
    const data = response([
      group('Lambda', [series('latency_p99', 'P99 Latency', [pt('2024-01-01T12:00:00Z', 3.5)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('3.5')).toBeInTheDocument();
  });

  // ── SparklineCard headline notes (lines 159-163) ───────────────────────────
  it('shows "last hour total" note for counter-type metrics', async () => {
    const data = response([
      group('Lambda', [series('invocations', 'Invocations', [pt('2024-01-01T12:00:00Z', 100)])]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('last hour total')).toBeInTheDocument();
  });

  it('shows "latest" note for gauge-type metrics', async () => {
    const data = response([
      group('Lambda', [
        series('concurrent', 'Concurrent Executions', [pt('2024-01-01T12:00:00Z', 5)]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('latest')).toBeInTheDocument();
  });

  // ── colorForMetric — all id branches (lines 111-117) ──────────────────────
  it.each([
    ['error_count', 'Error Count'],
    ['4xx_errors', '4xx Errors'],
    ['5xx_errors', '5xx Errors'],
    ['throttle_count', 'Throttles'],
    ['duration_p99', 'Duration P99 (ms)'],
    ['latency_p99', 'P99 Latency (ms)'],
    ['concurrent', 'Concurrent Executions'],
    ['cache_hit', 'Cache Hit Rate (%)'],
    ['bytes_in', 'Bytes In'],
    ['request_count', 'Request Count'],
  ])('colorForMetric: renders without crash for id="%s"', async (id, label) => {
    const data = response([group('Test', [series(id, label, [pt('2024-01-01T12:00:00Z', 1)])])]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // ── currentValue edge case: all-zero array returns last element value ───────
  it('currentValue: returns 0 when all dataPoints are 0 (gauge → "0")', async () => {
    const data = response([
      group('Lambda', [
        series('concurrent', 'Concurrent Executions', [
          pt('2024-01-01T11:00:00Z', 0),
          pt('2024-01-01T12:00:00Z', 0),
        ]),
      ]),
    ]);
    mockOk(data);
    await act(async () => {
      render(<AwsMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

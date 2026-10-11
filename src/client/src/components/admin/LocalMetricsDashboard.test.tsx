/**
 * LocalMetricsDashboard.test.tsx
 *
 * Coverage targets (SonarQube uncovered lines):
 *  - Line 75: formatTime — called during chart render
 *  - Line 78: formatShortTime — called during chart render
 *  - Lines 90-100: ChartTooltip — active and inactive branches
 *  - Lines 96-100: ChartTooltip payload rendering (name, value, unit)
 *  - Lines 162, 183, 203, 223: chart areas rendered when samples.length > 1
 *  - Lines 247, 268, 295: HTTP metric chart areas
 *  - Lines 339-344: auto-refresh timer setInterval / clearInterval
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import LocalMetricsDashboard from './LocalMetricsDashboard';

// ── Recharts stub ─────────────────────────────────────────────────────────────
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart">{children}</div>,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Area: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: any) => {
    // Support both function render-props and JSX element (Recharts cloneElement API)
    const props = {
      active: true,
      payload: [{ value: 42.5, name: 'cpu', color: '#60a5fa' }],
      label: Date.now(),
    };
    // eslint-disable-next-line @eslint-react/no-clone-element
    const el = typeof content === 'function' ? content(props) : React.cloneElement(content, props);
    return el ?? null;
  },
}));

// ── Mock useWebSocket (transitively imported by parent) ───────────────────────
vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }));

// ── Data factories ────────────────────────────────────────────────────────────

const osSample = (
  overrides: Partial<{
    ts: number;
    cpu: number;
    heapUsed: number;
    heapTotal: number;
    rss: number;
    load: number;
  }> = {}
) => ({
  ts: Date.now(),
  cpu: 25,
  heapUsed: 120.5,
  heapTotal: 512,
  rss: 200,
  load: 0.75,
  ...overrides,
});

const httpSample = (
  overrides: Partial<{
    ts: number;
    r2xx: number;
    r3xx: number;
    r4xx: number;
    r5xx: number;
    count: number;
    mean: number;
  }> = {}
) => ({
  ts: Date.now(),
  r2xx: 5,
  r3xx: 0,
  r4xx: 1,
  r5xx: 0,
  count: 6,
  mean: 42.5,
  ...overrides,
});

const metricsResponse = (
  osSamples: any[] = [],
  httpSamples: any[] = [],
  overrides: Record<string, any> = {}
) => ({
  osSamples,
  httpSamples,
  intervalMs: 5000,
  generatedAt: new Date().toISOString(),
  ...overrides,
});

const AUTH = { Authorization: 'Basic dGVzdA==' };

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
function mockNetworkError(msg: string) {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(msg));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalMetricsDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Loading skeleton (lines 385-387) ──────────────────────────────────────
  it('shows "Loading metrics…" before first fetch resolves', async () => {
    let resolveIt: (v: any) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolveIt = r;
      })
    );

    render(<LocalMetricsDashboard authHeader={AUTH} />);
    expect(screen.getByText(/Loading metrics/i)).toBeInTheDocument();

    await act(async () => {
      resolveIt!({ ok: true, json: () => Promise.resolve(metricsResponse()) });
    });
  });

  // ── Error states (lines 379-383) ──────────────────────────────────────────
  it('shows error message on HTTP failure', async () => {
    mockHttpError(503, { error: 'Service down' });
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Service down/i)).toBeInTheDocument();
  });

  it('falls back to HTTP status when error body is empty', async () => {
    mockHttpError(500, {});
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
  });

  it('shows network error message on fetch rejection', async () => {
    mockNetworkError('Network error');
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  // ── Successful render — section headers (lines 391, 399) ─────────────────
  it('renders "Process & System" and "HTTP Traffic" sections when data is loaded', async () => {
    mockOk(metricsResponse([osSample()], [httpSample()]));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Process & System/i)).toBeInTheDocument();
    expect(screen.getByText(/HTTP Traffic/i)).toBeInTheDocument();
  });

  // ── Last-updated timestamp (lines 372-376) ────────────────────────────────
  it('shows "Last updated" timestamp after fetch', async () => {
    mockOk(metricsResponse([osSample()], [httpSample()]));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Last updated/i)).toBeInTheDocument();
  });

  // ── intervalMs shown in footer (line 409) ─────────────────────────────────
  it('shows sample interval from response in the footer', async () => {
    mockOk(metricsResponse([osSample()], [httpSample()], { intervalMs: 10_000 }));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText(/Sampled every 10s/i)).toBeInTheDocument();
  });

  it('shows default 5s interval when no data is loaded yet', async () => {
    let resolveIt: (v: any) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolveIt = r;
      })
    );
    render(<LocalMetricsDashboard authHeader={AUTH} />);
    expect(screen.getByText(/Sampled every 5s/i)).toBeInTheDocument();
    await act(async () => {
      resolveIt!({ ok: true, json: () => Promise.resolve(metricsResponse()) });
    });
  });

  // ── CpuCard (line 162) ────────────────────────────────────────────────────
  it('renders CPU Usage card headline', async () => {
    mockOk(metricsResponse([osSample({ cpu: 42.5 })], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
  });

  it('renders chart for CpuCard when samples.length > 1', async () => {
    mockOk(metricsResponse([osSample(), osSample()], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    // chart-container divs rendered by stubbed ResponsiveContainer
    expect(screen.getAllByTestId('chart').length).toBeGreaterThan(0);
  });

  it('shows NoData placeholder in CpuCard when only 1 sample', async () => {
    mockOk(metricsResponse([osSample()], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getAllByText('Collecting…').length).toBeGreaterThan(0);
  });

  // ── HeapCard (line 183) ───────────────────────────────────────────────────
  it('renders Heap Usage card headline and percentage note', async () => {
    mockOk(metricsResponse([osSample({ heapUsed: 256, heapTotal: 512 })], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Heap Usage')).toBeInTheDocument();
    expect(screen.getByText('256 MB')).toBeInTheDocument();
    // headlineNote includes "50% of 512 MB limit"
    expect(screen.getByText(/50% of 512 MB limit/i)).toBeInTheDocument();
  });

  // ── RssCard (line 203) ────────────────────────────────────────────────────
  it('renders RSS Memory card headline', async () => {
    mockOk(metricsResponse([osSample({ rss: 300 })], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('RSS Memory')).toBeInTheDocument();
    expect(screen.getByText('300 MB')).toBeInTheDocument();
  });

  // ── LoadCard (line 223) ───────────────────────────────────────────────────
  it('renders Load Average card headline', async () => {
    mockOk(metricsResponse([osSample({ load: 1.23 })], []));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Load Average')).toBeInTheDocument();
    expect(screen.getByText('1.23')).toBeInTheDocument();
  });

  // ── RequestRateCard (line 247) ────────────────────────────────────────────
  it('renders Successful Requests card with summed total', async () => {
    const samples = [httpSample({ r2xx: 3, r3xx: 1 }), httpSample({ r2xx: 2, r3xx: 0 })];
    mockOk(metricsResponse([], samples));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Successful Requests')).toBeInTheDocument();
    // last 10 samples: r2xx+r3xx = 3+1 + 2+0 = 6
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  // ── ErrorRateCard (line 268) ──────────────────────────────────────────────
  it('renders Error Responses card', async () => {
    const samples = [httpSample({ r4xx: 2, r5xx: 1 }), httpSample({ r4xx: 0, r5xx: 0 })];
    mockOk(metricsResponse([], samples));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Error Responses')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // 2+1+0+0
  });

  // ── LatencyCard (line 295) ────────────────────────────────────────────────
  it('renders Mean Response Time card', async () => {
    const samples = [httpSample({ count: 2, mean: 100 }), httpSample({ count: 2, mean: 200 })];
    mockOk(metricsResponse([], samples));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('Mean Response Time')).toBeInTheDocument();
    expect(screen.getByText(/150.0 ms/i)).toBeInTheDocument();
  });

  it('shows 0.0 ms latency when no samples have count > 0', async () => {
    const samples = [httpSample({ count: 0, mean: 0 })];
    mockOk(metricsResponse([], samples));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getByText('0.0 ms')).toBeInTheDocument();
  });

  // ── HTTP card charts when samples.length > 1 ─────────────────────────────
  it('renders charts (not NoData) for HTTP cards when samples.length > 1', async () => {
    // Provide 2 OS samples AND 2 HTTP samples so ALL cards render charts, not NoData
    const samples = [httpSample(), httpSample()];
    mockOk(metricsResponse([osSample(), osSample()], samples));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.queryByText('Collecting…')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('chart').length).toBeGreaterThan(0);
  });

  // ── NoData fallback for HTTP cards ────────────────────────────────────────
  it('shows NoData placeholders for HTTP cards when only 1 sample', async () => {
    mockOk(metricsResponse([], [httpSample()]));
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });
    expect(screen.getAllByText('Collecting…').length).toBeGreaterThan(0);
  });

  // ── Refresh button ────────────────────────────────────────────────────────
  it('calls fetch again when Refresh Now button is clicked', async () => {
    mockOk(metricsResponse());
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });

    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(metricsResponse()) } as any);
    globalThis.fetch = spy;

    await act(async () => {
      fireEvent.click(screen.getByText(/Refresh Now/i));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // ── Auto-refresh toggle (lines 339-344) ───────────────────────────────────
  it('clears interval when auto-refresh checkbox is unchecked', async () => {
    mockOk(metricsResponse());
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('fires extra fetch after 10 seconds when auto-refresh is on', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(metricsResponse()) } as any);
    globalThis.fetch = spy;
    await act(async () => {
      render(<LocalMetricsDashboard authHeader={AUTH} />);
    });

    const callsAfterMount = spy.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});

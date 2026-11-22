import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { io } from 'socket.io-client';
import SystemOverviewSection from '../components/admin/SystemOverviewSection';

const getMockSocket = () => (io as any)();

const defaultProps = {
  authHeader: { Authorization: 'Bearer test-token' },
  refreshCounter: 0,
};

const mockLocalMetrics = {
  osSamples: [
    { ts: Date.now() - 10000, cpu: 12.5, heapUsed: 45.2, heapTotal: 512, rss: 110.5, load: 1.2 },
    { ts: Date.now() - 5000, cpu: 15, heapUsed: 46.8, heapTotal: 512, rss: 112.1, load: 1.4 },
    { ts: Date.now(), cpu: 18.2, heapUsed: 48.1, heapTotal: 512, rss: 115, load: 1.5 },
  ],
  httpSamples: [
    { ts: Date.now() - 10000, r2xx: 12, r3xx: 1, r4xx: 0, r5xx: 0, count: 13, mean: 42.5 },
    { ts: Date.now() - 5000, r2xx: 15, r3xx: 0, r4xx: 1, r5xx: 0, count: 16, mean: 45 },
    { ts: Date.now(), r2xx: 20, r3xx: 2, r4xx: 0, r5xx: 1, count: 23, mean: 50.2 },
  ],
  intervalMs: 5000,
  generatedAt: new Date().toISOString(),
};

const mockAwsMetrics = {
  groups: [
    {
      title: 'Lambda — wishboard-express-api',
      metrics: [
        {
          id: 'lambda_invocations',
          label: 'Invocations',
          dataPoints: [
            { t: new Date(Date.now() - 120000).toISOString(), v: 5 },
            { t: new Date(Date.now() - 60000).toISOString(), v: 10 },
            { t: new Date(Date.now()).toISOString(), v: 15 },
          ],
        },
        {
          id: 'lambda_errors',
          label: 'Errors',
          dataPoints: [
            { t: new Date(Date.now() - 120000).toISOString(), v: 0 },
            { t: new Date(Date.now() - 60000).toISOString(), v: 1 },
            { t: new Date(Date.now()).toISOString(), v: 0 },
          ],
        },
      ],
    },
    {
      title: 'API Gateway (HTTP)',
      metrics: [
        {
          id: 'apigw_count',
          label: 'API Requests',
          dataPoints: [
            { t: new Date(Date.now() - 120000).toISOString(), v: 25 },
            { t: new Date(Date.now() - 60000).toISOString(), v: 30 },
            { t: new Date(Date.now()).toISOString(), v: 35 },
          ],
        },
      ],
    },
  ],
  generatedAt: new Date().toISOString(),
};

/** Helper: mock fetch with configurable per-URL responses */
const mockFetch = (overrides: Record<string, object> = {}) => {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url.includes(key)) {
        return Promise.resolve({ ok: true, json: async () => value });
      }
    }
    // Default: /api/config → local mode; /api/admin/logs → empty; anything else fails
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, json: async () => ({ realtimeProvider: 'socketio' }) });
    }
    if (url.includes('/api/admin/logs')) {
      return Promise.resolve({ ok: true, json: async () => ({ logs: 'initial log line' }) });
    }
    if (url.includes('/api/admin/local-metrics')) {
      return Promise.resolve({ ok: true, json: async () => mockLocalMetrics });
    }
    if (url.includes('/api/admin/aws-metrics')) {
      return Promise.resolve({ ok: true, json: async () => mockAwsMetrics });
    }
    return Promise.resolve({ ok: false });
  }) as any;
};

describe('SystemOverviewSection WebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches /api/config on mount to detect deployment mode', async () => {
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/config'))
    );
  });

  it('loads initial logs via fetch on mount', async () => {
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/logs'),
        expect.anything()
      )
    );
  });

  it('renders LocalMetricsDashboard in local (socketio) mode', async () => {
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/live in-process metrics/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('CPU Usage')).toBeInTheDocument());
  });

  it('renders AwsMetricsDashboard in serverless (apigateway) mode', async () => {
    mockFetch({ '/api/config': { realtimeProvider: 'apigateway' } });
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/CloudWatch metrics/i)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText('Lambda — wishboard-express-api')).toBeInTheDocument()
    );
  });

  it('appends incoming sys:log events to the log display', async () => {
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/initial log line/i)).toBeInTheDocument());

    const socket = getMockSocket();
    const sysLogHandler = (socket.on as any).mock.calls.find(
      (call: any) => call[0] === 'sys:log'
    )?.[1];
    expect(sysLogHandler).toBeDefined();

    act(() => {
      sysLogHandler('[2026-01-01 00:00:00] info: A new live log entry');
    });

    await waitFor(() => expect(screen.getByText(/A new live log entry/)).toBeInTheDocument());
  });

  it('appends multiple log lines in sequence', async () => {
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/initial log line/i)).toBeInTheDocument());

    const socket = getMockSocket();
    const sysLogHandler = (socket.on as any).mock.calls.find(
      (call: any) => call[0] === 'sys:log'
    )?.[1];

    act(() => {
      sysLogHandler('Line alpha');
      sysLogHandler('Line beta');
    });

    await waitFor(() => {
      expect(screen.getByText(/Line alpha/)).toBeInTheDocument();
      expect(screen.getByText(/Line beta/)).toBeInTheDocument();
    });
  });

  it('cleans up sys:log listener on unmount', async () => {
    const { unmount } = render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const socket = getMockSocket();
    unmount();

    expect(socket.off).toHaveBeenCalledWith('sys:log', expect.any(Function));
  });

  it('handles logs fetch failure gracefully', async () => {
    mockFetch({ '/api/admin/logs': {} }); // ok:false path
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/config')) {
        return Promise.resolve({ ok: true, json: async () => ({ realtimeProvider: 'socketio' }) });
      }
      if (url.includes('/api/admin/local-metrics')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            osSamples: [],
            httpSamples: [],
            intervalMs: 5000,
            generatedAt: new Date().toISOString(),
          }),
        });
      }
      // logs endpoint fails
      return Promise.resolve({ ok: false });
    }) as any;

    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Failed to load logs\./i)).toBeInTheDocument());
  });

  it('handles AwsMetricsDashboard fetch error gracefully', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ realtimeProvider: 'apigateway' }),
        });
      }
      if (url.includes('/api/admin/logs')) {
        return Promise.resolve({ ok: true, json: async () => ({ logs: '' }) });
      }
      if (url.includes('/api/admin/aws-metrics')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Access Denied to CloudWatch' }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/Error:/i)).toBeInTheDocument());
    expect(screen.getByText(/Access Denied to CloudWatch/i)).toBeInTheDocument();
  });

  it('allows toggling auto-refresh in local and serverless dashboards', async () => {
    // 1. Local mode toggle
    const { unmount } = render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('CPU Usage')).toBeInTheDocument());

    const checkbox = screen.getByLabelText(/Auto-refresh every 10s/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    act(() => {
      checkbox.click();
    });
    expect(checkbox.checked).toBe(false);
    unmount();

    // 2. Serverless mode toggle
    mockFetch({ '/api/config': { realtimeProvider: 'apigateway' } });
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('Lambda — wishboard-express-api')).toBeInTheDocument()
    );

    const awsCheckbox = screen.getByLabelText(/Auto-refresh every 30s/i) as HTMLInputElement;
    expect(awsCheckbox.checked).toBe(true);

    act(() => {
      awsCheckbox.click();
    });
    expect(awsCheckbox.checked).toBe(false);
  });

  it('covers various log levels and fallback parsing logic', async () => {
    mockFetch({
      '/api/admin/logs': {
        logs: [
          '', // empty line
          '[WS] [2026-01-01 12:00:00] info: WS Info msg',
          '[2026-01-01 12:00:01] warn: Warning msg',
          '[2026-01-01 12:00:02] warning: Warning2 msg',
          '[2026-01-01 12:00:03] error: Error msg',
          '[2026-01-01 12:00:04] err: Err msg',
          '[2026-01-01 12:00:05] debug: Debug msg',
          '[2026-01-01 12:00:06] other: Other msg',
          'Fallback error message',
          'Fallback warn message',
          'Fallback warning: message',
          'Fallback info: message',
          'Fallback debug: message',
          'Fallback other message',
          '[WS] Fallback ws message',
        ].join('\n'),
      },
    });

    render(<SystemOverviewSection {...defaultProps} />);
    // Verify one of them shows up to confirm rendering
    await waitFor(() => expect(screen.getByText('WS Info msg')).toBeInTheDocument());
    expect(screen.getByText('Warning msg')).toBeInTheDocument();
    expect(screen.getByText('Warning2 msg')).toBeInTheDocument();
    expect(screen.getByText('Error msg')).toBeInTheDocument();
    expect(screen.getByText('Err msg')).toBeInTheDocument();
    expect(screen.getByText('Debug msg')).toBeInTheDocument();
    expect(screen.getByText('Other msg')).toBeInTheDocument();
    expect(screen.getByText('Fallback error message')).toBeInTheDocument();
    expect(screen.getByText('Fallback warn message')).toBeInTheDocument();
    expect(screen.getByText('Fallback warning: message')).toBeInTheDocument();
    expect(screen.getByText('Fallback info: message')).toBeInTheDocument();
    expect(screen.getByText('Fallback debug: message')).toBeInTheDocument();
    expect(screen.getByText('Fallback other message')).toBeInTheDocument();
    expect(screen.getByText('Fallback ws message')).toBeInTheDocument();
  });

  it('correctly parses AWS CloudWatch Lambda log format', async () => {
    mockFetch({
      '/api/admin/logs': {
        logs: [
          '2026-07-26T03:10:07.625Z undefined WARN Skipping unsupported "PRAGMA busy_timeout = 5000" on this database driver: SQL_PARSE_ERROR: SQL not allowed statement: PRAGMA busy_timeout = 5000',
          '2026-07-26T03:10:07.720Z undefined DEBUG Ignored: columns may have already been dropped',
        ].join('\n'),
      },
    });

    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Skipping unsupported "PRAGMA busy_timeout = 5000"/)
      ).toBeInTheDocument()
    );
    expect(screen.getByText('Ignored: columns may have already been dropped')).toBeInTheDocument();
    expect(screen.getByText('DEBUG')).toBeInTheDocument();
    expect(screen.getByText('WARN')).toBeInTheDocument();
  });

  it('toggles repeating logs filter', async () => {
    mockFetch({
      '/api/admin/logs': {
        logs: [
          'Line 1',
          'GET /api/admin/logs 200',
          'GET /api/wishes/random 200',
          'GET /api/admin/local-metrics 200',
        ].join('\n'),
      },
    });

    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Line 1')).toBeInTheDocument());

    // By default, repeating logs are filtered out
    expect(screen.queryByText(/GET \/api\/admin\/logs/)).not.toBeInTheDocument();

    // Toggle the filter repeating logs checkbox
    const filterCheckbox = screen.getByLabelText(/Filter repeating logs/i) as HTMLInputElement;
    expect(filterCheckbox.checked).toBe(true);

    act(() => {
      filterCheckbox.click();
    });
    expect(filterCheckbox.checked).toBe(false);

    // Now repeating logs should be visible
    await waitFor(() => expect(screen.getByText(/GET \/api\/admin\/logs/)).toBeInTheDocument());
    expect(screen.getByText(/GET \/api\/wishes\/random/)).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/admin\/local-metrics/)).toBeInTheDocument();
  });

  // Rendering 2000+ log-line nodes and polling getByText over that large tree
  // is inherently slow (~5s), so give this test a generous budget. On a loaded
  // CPU (e.g. the pre-push hook runs `vite build` right before the suite) the
  // default 5s testTimeout / 1s waitFor were tripping intermittently. See #142.
  it('clips logs exceeding 2000 lines', async () => {
    // Generate 2005 log lines
    const initialLogs = Array.from({ length: 2005 }, (_, i) => `log line ${i}`).join('\n');
    mockFetch({
      '/api/admin/logs': { logs: initialLogs },
    });

    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('log line 2004')).toBeInTheDocument(), {
      timeout: 10000,
    });

    const socket = getMockSocket();
    const sysLogHandler = (socket.on as any).mock.calls.find(
      (call: any) => call[0] === 'sys:log'
    )?.[1];

    act(() => {
      sysLogHandler('new live log line');
    });

    await waitFor(() => expect(screen.getByText('new live log line')).toBeInTheDocument(), {
      timeout: 10000,
    });
    // Since it exceeded 2000 lines, log line 0 should be gone
    expect(screen.queryByText('log line 0')).not.toBeInTheDocument();
  }, 15000);

  it('subscribes to the admin-only sys:log channel on mount, unsubscribes on unmount', async () => {
    const { unmount } = render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const socket = getMockSocket();
    // Token is extracted from the Bearer auth header.
    expect(socket.emit).toHaveBeenCalledWith('subscribe', {
      channel: 'sys:log',
      token: 'test-token',
    });

    unmount();
    expect(socket.emit).toHaveBeenCalledWith('unsubscribe', { channel: 'sys:log' });
  });

  it('subscribes with an empty token when no auth header is present', async () => {
    render(<SystemOverviewSection authHeader={{}} refreshCounter={0} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const socket = getMockSocket();
    expect(socket.emit).toHaveBeenCalledWith('subscribe', { channel: 'sys:log', token: '' });
  });

  it('displays AI Engine status badge for enabled cloud, enabled local, and disabled noop configs', async () => {
    mockFetch({
      '/api/config': {
        realtimeProvider: 'apigateway',
        ai: { enabled: true, provider: 'cloud', model: 'gemini-flash-latest' },
      },
    });
    const { unmount } = render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByTestId('ai-engine-status')).toHaveTextContent(
        'AI Engine: Enabled — cloud (gemini-flash-latest)'
      )
    );
    unmount();

    mockFetch({
      '/api/config': {
        realtimeProvider: 'socketio',
        ai: { enabled: true, provider: 'local', model: null },
      },
    });
    const { unmount: unmount2 } = render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByTestId('ai-engine-status')).toHaveTextContent('AI Engine: Enabled — local')
    );
    unmount2();

    mockFetch({
      '/api/config': {
        realtimeProvider: 'socketio',
        ai: { enabled: false, provider: 'noop', model: null },
      },
    });
    render(<SystemOverviewSection {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByTestId('ai-engine-status')).toHaveTextContent('AI Engine: Disabled (noop)')
    );
  });
});

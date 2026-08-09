import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import {
  formatTime,
  formatShortTime,
  formatValue,
  CustomTooltip,
  MetricCard,
  NoData,
  SectionTitle,
  Grid,
  MetricsToolbar,
  gradDef,
} from './DashboardShared';

describe('formatTime', () => {
  it('formats string timestamp to HH:MM', () => {
    const timeStr = formatTime('2023-01-01T14:30:00Z');
    expect(timeStr).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats numeric timestamp to HH:MM:SS', () => {
    // 1672583400000 = 2023-01-01T14:30:00.000Z
    const timeStr = formatTime(1672583400000);
    expect(timeStr).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns "Invalid Date" or empty string for invalid dates', () => {
    const timeStr = formatTime('invalid-date');
    expect(['', 'Invalid Date']).toContain(timeStr);
  });

  it('returns empty string when an error is thrown', () => {
    const badInput = {
      valueOf: () => { throw new Error('forced throw'); }
    } as any;
    expect(formatTime(badInput)).toBe('');
  });
});

describe('gradDef', () => {
  it('renders a linear gradient with correct id and stroke color', () => {
    render(
      <svg>
        {gradDef('test-grad', { stroke: '#ff0000' })}
      </svg>
    );
    const gradient = document.querySelector('linearGradient');
    expect(gradient).toBeInTheDocument();
    expect(gradient).toHaveAttribute('id', 'test-grad');

    const stops = document.querySelectorAll('stop');
    expect(stops).toHaveLength(2);
    // React outputs 'stop-color' for stopColor camelCase attribute
    expect(stops[0]).toHaveAttribute('stop-color', '#ff0000');
    expect(stops[1]).toHaveAttribute('stop-color', '#ff0000');
  });
});

describe('formatShortTime', () => {
  it('formats numeric timestamp to HH:MM', () => {
    const timeStr = formatShortTime(1672583400000);
    expect(timeStr).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('formatValue', () => {
  it('formats bytes correctly', () => {
    expect(formatValue(500, 'Bytes')).toBe('500 B');
    expect(formatValue(1536, 'Network Bytes')).toBe('1.5 KB');
    expect(formatValue(1048576 * 2.5, 'Memory (bytes)')).toBe('2.5 MB');
    expect(formatValue(1073741824 * 3.14, 'Disk Bytes')).toBe('3.14 GB');
  });

  it('formats milliseconds (ms) correctly', () => {
    expect(formatValue(123.456, 'Latency (ms)')).toBe('123 ms');
  });

  it('formats percentages (%) correctly', () => {
    expect(formatValue(99.99, 'CPU Usage (%)')).toBe('100.0%');
    expect(formatValue(45.67, 'Memory (%)')).toBe('45.7%');
  });

  it('formats 0 as "0"', () => {
    expect(formatValue(0, 'Connections')).toBe('0');
  });

  it('formats integers as string', () => {
    expect(formatValue(42, 'Active Users')).toBe('42');
  });

  it('formats floats with 1 decimal place', () => {
    expect(formatValue(42.45, 'Requests/sec')).toBe('42.5');
  });
});

describe('MetricCard', () => {
  it('renders correctly with title, headline, and children', () => {
    render(
      <MetricCard title="Test Title" headline="Test Headline" headlineNote="Note">
        <div data-testid="child">Child Content</div>
      </MetricCard>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Headline')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders without headlineNote', () => {
    render(
      <MetricCard title="Test Title" headline="Test Headline">
        <div>Child</div>
      </MetricCard>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
  });
});

describe('NoData', () => {
  it('renders default text', () => {
    render(<NoData />);
    expect(screen.getByText('Collecting…')).toBeInTheDocument();
  });

  it('renders custom text', () => {
    render(<NoData text="No data available" />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});

describe('SectionTitle', () => {
  it('renders children correctly', () => {
    render(<SectionTitle>My Section</SectionTitle>);
    expect(screen.getByText('My Section')).toBeInTheDocument();
  });
});

describe('Grid', () => {
  it('renders children', () => {
    render(
      <Grid>
        <div data-testid="grid-child">Grid Item</div>
      </Grid>
    );
    expect(screen.getByTestId('grid-child')).toBeInTheDocument();
  });
});

describe('MetricsToolbar', () => {
  it('renders default state correctly', () => {
    const fetchMetrics = vi.fn();
    const setAutoRefresh = vi.fn();

    render(
      <MetricsToolbar
        loading={false}
        autoRefresh={false}
        setAutoRefresh={setAutoRefresh}
        fetchMetrics={fetchMetrics}
        refreshIntervalLabel="1m"
      />
    );

    expect(screen.getByText('⟳ Refresh Now')).toBeInTheDocument();
    expect(screen.getByText('Auto-refresh every 1m')).toBeInTheDocument();
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();

    const refreshBtn = screen.getByRole('button', { name: '⟳ Refresh Now' });
    fireEvent.click(refreshBtn);
    expect(fetchMetrics).toHaveBeenCalledTimes(1);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(setAutoRefresh).toHaveBeenCalledWith(true);
  });

  it('renders loading state correctly', () => {
    render(
      <MetricsToolbar
        loading={true}
        autoRefresh={true}
        setAutoRefresh={vi.fn()}
        fetchMetrics={vi.fn()}
        refreshIntervalLabel="5s"
      />
    );
    const refreshBtn = screen.getByRole('button');
    expect(refreshBtn).toHaveTextContent('⟳ Refreshing…');
    expect(refreshBtn).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('displays generatedAt timestamp', () => {
    render(
      <MetricsToolbar
        loading={false}
        autoRefresh={false}
        setAutoRefresh={vi.fn()}
        fetchMetrics={vi.fn()}
        refreshIntervalLabel="10s"
        generatedAt="2023-01-01T10:00:00Z"
      />
    );
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });
});

describe('CustomTooltip', () => {
  it('returns null when not active', () => {
    const { container } = render(<CustomTooltip active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when active but payload is empty', () => {
    const { container } = render(<CustomTooltip active={true} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders AWS format correctly (metricLabel provided)', () => {
    render(
      <CustomTooltip
        active={true}
        payload={[{ value: 1234 }]}
        label="2023-01-01T12:00:00Z"
        metricLabel="Bytes"
      />
    );
    expect(screen.getByText('1.2 KB')).toBeInTheDocument();
  });

  it('renders multi-payload format correctly', () => {
    render(
      <CustomTooltip
        active={true}
        payload={[
          { value: 10, name: 'Series A', color: 'red' },
          { value: 20, name: 'Series B', color: 'blue' },
          { value: undefined, name: 'Series C', color: 'green' },
        ]}
        label="2023-01-01T12:00:00Z"
        unit="ms"
      />
    );

    expect(screen.getByText('Series A:')).toBeInTheDocument();
    expect(screen.getByText('10.0ms')).toBeInTheDocument();

    expect(screen.getByText('Series B:')).toBeInTheDocument();
    expect(screen.getByText('20.0ms')).toBeInTheDocument();

    expect(screen.getByText('Series C:')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

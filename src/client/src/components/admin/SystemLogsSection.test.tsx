import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SystemLogsSection from './SystemLogsSection';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));

describe('SystemLogsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders and parses Winston and CloudWatch log lines correctly', async () => {
    const sampleLogs = [
      '[WS] [2026-10-11T12:00:00Z] info: WebSocket connection established',
      '2026-10-11T12:05:00.123Z req-uuid-1234 WARN CloudWatch warning message',
      'error: unhandled exception in background worker',
      'Regular unformatted log line without level',
    ].join('\n');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ logs: sampleLogs, source: 'cloudwatch' }),
    });

    render(<SystemLogsSection authHeader={{ Authorization: 'Bearer token' }} refreshCounter={0} />);

    await waitFor(() => {
      expect(screen.getByText('WebSocket connection established')).toBeInTheDocument();
    });

    expect(screen.getByText('CloudWatch warning message')).toBeInTheDocument();
    expect(screen.getByText('unhandled exception in background worker')).toBeInTheDocument();
    expect(screen.getByText('Regular unformatted log line without level')).toBeInTheDocument();
    expect(screen.getByText(/Recent server logs from AWS CloudWatch Logs/)).toBeInTheDocument();
  });

  it('handles fetch failure gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    });

    render(<SystemLogsSection authHeader={{ Authorization: 'Bearer token' }} refreshCounter={0} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load logs.')).toBeInTheDocument();
    });
  });

  it('toggles repeating filters and tailing controls', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ logs: 'info: message\n/api/admin/logs', source: 'local' }),
    });

    render(<SystemLogsSection authHeader={{ Authorization: 'Bearer token' }} refreshCounter={0} />);

    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument();
    });

    const filterCheckbox = screen.getByLabelText(/Filter repeating logs/i);
    expect(filterCheckbox).toBeChecked();
    fireEvent.click(filterCheckbox);
    expect(filterCheckbox).not.toBeChecked();

    const pauseButton = screen.getByRole('button', { name: /Pause Tailing/i });
    fireEvent.click(pauseButton);
    expect(screen.getByRole('button', { name: /Resume Tailing/i })).toBeInTheDocument();
  });
});

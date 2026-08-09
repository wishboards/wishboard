import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'other';

export interface ParsedLogEntry {
  id: string;
  prefix: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  raw: string;
}

// eslint-disable-next-line no-control-regex -- intentionally matches ANSI escape sequences
const ansiRegex = /\u001b?\[[0-9;]*m/g;
const winstonRegex = /^(?:\[(WS)\]\s*)?(?:\[([0-9T:.\s-]+)\]\s*)?(\w+):\s*(.*)$/i;
const cloudwatchRegex =
  /^(?:\[(WS)\]\s*)?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}\S*)\s+(\S+)\s+(INFO|WARN|WARNING|ERROR|ERR|DEBUG|TRACE)\b\s*(.*)$/i;

function normalizeLogLevel(raw: string): LogLevel {
  const l = raw.trim().toLowerCase();
  if (l === 'info') return 'info';
  if (l === 'warn' || l === 'warning') return 'warn';
  if (l === 'error' || l === 'err') return 'error';
  if (l === 'debug' || l === 'trace') return 'debug';
  return 'other';
}

function parseLogLine(line: string, idx: number): ParsedLogEntry {
  const cleanLine = line.replace(ansiRegex, '').trim();
  if (!cleanLine) {
    return {
      id: `${idx}-empty`,
      prefix: '',
      timestamp: '',
      level: 'other',
      message: '',
      raw: '',
    };
  }

  // Check Winston format first
  const winstonMatch = winstonRegex.exec(cleanLine);
  if (winstonMatch) {
    const prefix = winstonMatch[1]?.trim() || '';
    const timestamp = winstonMatch[2]?.trim() || '';
    const message = winstonMatch[4] || '';

    return {
      id: `${idx}-${timestamp}-${message.slice(0, 10)}`,
      prefix,
      timestamp,
      level: normalizeLogLevel(winstonMatch[3] || ''),
      message,
      raw: cleanLine,
    };
  }

  // Check CloudWatch Lambda format next
  const cloudwatchMatch = cloudwatchRegex.exec(cleanLine);
  if (cloudwatchMatch) {
    const prefix = cloudwatchMatch[1]?.trim() || '';
    const rawTs = cloudwatchMatch[2]?.trim() || '';
    const formattedTs = rawTs
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
      .replace(/Z$/, '');
    const message = cloudwatchMatch[5] || '';

    return {
      id: `${idx}-${formattedTs}-${message.slice(0, 10)}`,
      prefix,
      timestamp: formattedTs,
      level: normalizeLogLevel(cloudwatchMatch[4] || ''),
      message,
      raw: cleanLine,
    };
  }

  // Fallback: check unformatted lines
  const prefix = cleanLine.startsWith('[WS]') ? '[WS]' : '';
  const textWithoutWs = cleanLine.startsWith('[WS]')
    ? cleanLine.replace(/^\[WS\]\s*/, '')
    : cleanLine;
  const cleanLower = textWithoutWs.toLowerCase();

  let level: LogLevel = 'other';
  if (
    /^(error|err)\b/i.test(textWithoutWs) ||
    cleanLower.includes('error:') ||
    cleanLower.includes('err:') ||
    cleanLower.includes('error message')
  ) {
    level = 'error';
  } else if (
    /^(warn|warning)\b/i.test(textWithoutWs) ||
    cleanLower.includes('warn:') ||
    cleanLower.includes('warning:') ||
    cleanLower.includes('warn message')
  ) {
    level = 'warn';
  } else if (/^info\b/i.test(textWithoutWs) || cleanLower.includes('info:')) {
    level = 'info';
  } else if (/^(debug|trace)\b/i.test(textWithoutWs) || cleanLower.includes('debug:')) {
    level = 'debug';
  }

  return {
    id: `${idx}-fallback`,
    prefix,
    timestamp: '',
    level,
    message: textWithoutWs,
    raw: cleanLine,
  };
}

interface SystemLogsSectionProps {
  authHeader: Record<string, string>;
  refreshCounter: number;
}

export default function SystemLogsSection({
  authHeader,
  refreshCounter,
}: Readonly<SystemLogsSectionProps>) {
  const [rawLogs, setRawLogs] = useState<string>('');
  const [filterRepeating, setFilterRepeating] = useState<boolean>(true);
  const [isTailing, setIsTailing] = useState<boolean>(true);
  const [logsSource, setLogsSource] = useState<string>('local');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const { socket } = useWebSocket();

  const loadLogs = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/logs?_t=${Date.now()}`, {
        headers: { ...authHeader, 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        setRawLogs('Failed to load logs.');
        return;
      }
      const data = await response.json();
      setRawLogs(data.logs || '');
      setLogsSource(data.source || 'local');
    } catch (e) {
      console.error(e);
      setRawLogs('Failed to load logs.');
    }
  }, [authHeader]);

  useEffect(() => {
    loadLogs();
  }, [refreshCounter, loadLogs]);

  const parsedLogs = useMemo(() => {
    const logsString = rawLogs || '';
    if (logsString === 'Failed to load logs.') {
      return [
        {
          id: 'error-load',
          prefix: '',
          timestamp: '',
          level: 'error' as const,
          message: 'Failed to load logs.',
          raw: 'Failed to load logs.',
        },
      ];
    }
    const lines = logsString.split('\n');
    const filteredLines = filterRepeating
      ? lines.filter(
          (line) =>
            !line.includes('/api/admin/logs') &&
            !line.includes('/api/wishes/random') &&
            !line.includes('/api/admin/local-metrics')
        )
      : lines;

    return filteredLines.map((line, idx) => parseLogLine(line, idx));
  }, [rawLogs, filterRepeating]);

  useEffect(() => {
    if (isTailing && logsEndRef.current)
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
  }, [parsedLogs, isTailing]);

  useEffect(() => {
    if (!socket) return;

    const handleNewLog = (logEntry: string) => {
      setRawLogs((prev = '') => {
        const lines = prev.split('\n');
        if (lines.length > 2000) lines.splice(0, lines.length - 2000);
        return lines.join('\n') + (prev ? '\n' : '') + logEntry;
      });
    };

    // sys:log is an admin-only, opt-in channel. Subscribe while this view is
    // mounted (re-subscribing after any reconnect), and unsubscribe on unmount so
    // an admin who navigates to another tab stops receiving the log stream. The
    // server rejects the subscription unless the token is an admin's. See #189.
    const token = (authHeader?.Authorization || '').replace(/^Bearer\s+/i, '');
    const subscribe = () => socket.emit('subscribe', { channel: 'sys:log', token });

    socket.on('sys:log', handleNewLog);
    socket.on('connect', subscribe);
    subscribe();

    return () => {
      socket.emit('unsubscribe', { channel: 'sys:log' });
      socket.off('sys:log', handleNewLog);
      socket.off('connect', subscribe);
    };
  }, [socket, authHeader]);

  return (
    <section>
      <h2>System Logs</h2>
      <p>
        {logsSource === 'cloudwatch'
          ? 'Recent server logs from AWS CloudWatch Logs — last hour of Lambda activity.'
          : 'Recent server logs including rate limit warnings and failed logins.'}
      </p>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '12px',
          marginBottom: '12px',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="secondary-button" onClick={() => setIsTailing(!isTailing)}>
          {isTailing ? 'Pause Tailing' : 'Resume Tailing'}
        </button>
        <button type="button" className="secondary-button" onClick={loadLogs}>
          Refresh Now
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={filterRepeating}
            onChange={(e) => setFilterRepeating(e.target.checked)}
          />
          <span>Filter repeating logs</span>
        </label>
      </div>
      <div
        ref={logsEndRef}
        style={{
          background: '#121214',
          border: '1px solid #2a2a2e',
          borderRadius: '6px',
          padding: '12px',
          overflowY: 'auto',
          height: '400px',
          fontFamily: 'JetBrains Mono, Fira Code, Monaco, Consolas, monospace',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#e4e4e7',
        }}
      >
        {parsedLogs.some((line) => line.raw) ? (
          parsedLogs.map((line, idx) => {
            if (!line.raw) return null;

            let levelColor = '#a1a1aa';
            let levelBg = 'transparent';
            if (line.level === 'info') {
              levelColor = '#4ade80';
            } else if (line.level === 'warn') {
              levelColor = '#fbbf24';
            } else if (line.level === 'error') {
              levelColor = '#f87171';
              levelBg = 'rgba(248, 113, 113, 0.1)';
            } else if (line.level === 'debug') {
              levelColor = '#60a5fa';
            }

            return (
              <div
                key={line.id || idx}
                style={{
                  display: 'flex',
                  padding: '2px 4px',
                  borderRadius: '3px',
                  backgroundColor: levelBg,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  alignItems: 'flex-start',
                  gap: '8px',
                  borderBottom: '1px solid #1a1a1c',
                }}
              >
                {line.timestamp && (
                  <span style={{ color: '#71717a', flexShrink: 0, userSelect: 'none' }}>
                    [{line.timestamp}]
                  </span>
                )}

                {line.prefix && (
                  <span style={{ color: '#c084fc', fontWeight: 'bold', flexShrink: 0 }}>
                    [{line.prefix}]
                  </span>
                )}

                {line.level !== 'other' && (
                  <span
                    style={{
                      color: levelColor,
                      fontWeight: 'bold',
                      minWidth: '45px',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  >
                    {line.level.toUpperCase()}
                  </span>
                )}

                <span
                  style={{ color: line.level === 'other' ? '#a1a1aa' : '#e4e4e7', flexGrow: 1 }}
                >
                  {line.message}
                </span>
              </div>
            );
          })
        ) : (
          <div style={{ color: '#71717a', textAlign: 'center', paddingTop: '180px' }}>
            No logs available.
          </div>
        )}
      </div>
    </section>
  );
}

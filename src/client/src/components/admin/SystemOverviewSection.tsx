import React, { useState, useEffect } from 'react';
import AwsMetricsDashboard from './AwsMetricsDashboard';
import LocalMetricsDashboard from './LocalMetricsDashboard';
import SystemLogsSection from './SystemLogsSection';
import { apiClient } from '../../api/client';

interface SystemOverviewSectionProps {
  authHeader: Record<string, string>;
  refreshCounter: number;
}

interface AiRuntimeStatus {
  enabled: boolean;
  provider: string;
  model?: string | null;
}

export default function SystemOverviewSection({
  authHeader,
  refreshCounter,
}: Readonly<SystemOverviewSectionProps>) {
  /** Whether the backend is running in AWS serverless (Lambda) mode */
  const [isServerlessMode, setIsServerlessMode] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState<AiRuntimeStatus | null>(null);

  // Detect deployment mode and AI engine status from /api/config
  useEffect(() => {
    apiClient
      .GET('/api/config')
      .then(({ data }) => {
        setIsServerlessMode(data?.realtimeProvider === 'apigateway');
        if (data?.ai) {
          setAiStatus(data.ai);
        }
      })
      .catch(() => setIsServerlessMode(false));
  }, []);

  const renderAiStatusLabel = (status: AiRuntimeStatus) => {
    if (!status.enabled) {
      return `Disabled (${status.provider})`;
    }
    return status.model
      ? `Enabled — ${status.provider} (${status.model})`
      : `Enabled — ${status.provider}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <section>
        <h2>System Metrics</h2>

        {aiStatus && (
          <div
            data-testid="ai-engine-status"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              padding: '6px 12px',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 600,
              border: aiStatus.enabled
                ? '1px solid rgba(139, 92, 246, 0.5)'
                : '1px solid rgba(148, 163, 184, 0.4)',
              backgroundColor: aiStatus.enabled
                ? 'rgba(139, 92, 246, 0.14)'
                : 'rgba(148, 163, 184, 0.1)',
            }}
          >
            <span aria-hidden="true">{aiStatus.enabled ? '✨' : '○'}</span>
            <span>AI Engine: {renderAiStatusLabel(aiStatus)}</span>
          </div>
        )}

        {isServerlessMode === null && (
          <p style={{ color: '#6b7280', fontSize: '13px' }}>Detecting deployment mode…</p>
        )}

        {isServerlessMode === true && (
          <>
            <p style={{ marginBottom: '16px', color: '#9ca3af', fontSize: '13px' }}>
              Live CloudWatch metrics from your AWS serverless deployment — Lambda, API Gateway, and
              CloudFront.
            </p>
            <AwsMetricsDashboard authHeader={authHeader} />
          </>
        )}

        {isServerlessMode === false && (
          <>
            <p style={{ marginBottom: '16px', color: '#9ca3af', fontSize: '13px' }}>
              Live in-process metrics — CPU, memory, and HTTP traffic.
            </p>
            <LocalMetricsDashboard authHeader={authHeader} />
          </>
        )}
      </section>

      <SystemLogsSection authHeader={authHeader} refreshCounter={refreshCounter} />
    </div>
  );
}

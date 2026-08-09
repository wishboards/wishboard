import React, { useState, useEffect } from 'react';
import AwsMetricsDashboard from './AwsMetricsDashboard';
import LocalMetricsDashboard from './LocalMetricsDashboard';
import SystemLogsSection from './SystemLogsSection';

interface SystemOverviewSectionProps {
  authHeader: Record<string, string>;
  refreshCounter: number;
}

export default function SystemOverviewSection({
  authHeader,
  refreshCounter,
}: Readonly<SystemOverviewSectionProps>) {
  /** Whether the backend is running in AWS serverless (Lambda) mode */
  const [isServerlessMode, setIsServerlessMode] = useState<boolean | null>(null);

  // Detect deployment mode from /api/config
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => setIsServerlessMode(cfg.realtimeProvider === 'apigateway'))
      .catch(() => setIsServerlessMode(false));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <section>
        <h2>System Metrics</h2>

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

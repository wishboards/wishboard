import React from 'react';

interface DemoSeederSectionProps {
  isProduction: boolean;
  hasDemoSeeds: boolean;
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  triggerRefresh: () => void;
  handledUnauthorized: (response: Response) => boolean;
}

export default function DemoSeederSection({
  isProduction,
  hasDemoSeeds,
  authHeader,
  setMessage,
  setError,
  triggerRefresh,
  handledUnauthorized,
}: Readonly<DemoSeederSectionProps>) {
  const runSeeder = async () => {
    setMessage(null);
    setError(null);
    const response = await fetch('/api/admin/reset-demo', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      if (handledUnauthorized(response)) return;
      setError('Failed to run seeder.');
      return;
    }
    const data = await response.json();
    setMessage(
      `Seeder completed: ${data.stats.usersCreated} users and ${data.stats.wishesCreated} wishes created.`
    );
    triggerRefresh();
  };

  return (
    <>
      {!isProduction && hasDemoSeeds && (
        <section
          style={{
            marginTop: '48px',
            padding: '16px',
            border: '1px solid #ff4444',
            borderRadius: '8px',
          }}
        >
          <h2 style={{ color: '#ff4444' }}>Demo Seeder</h2>
          <p>
            Generate simulated users and wishes for testing.{' '}
            <strong>Warning: This clears existing demo data.</strong>
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={runSeeder}
            style={{ marginTop: '12px', borderColor: '#ff4444', color: '#ff4444' }}
          >
            Run Seeder
          </button>
        </section>
      )}

      {!isProduction && !hasDemoSeeds && (
        <section
          style={{
            marginTop: '48px',
            padding: '16px',
            border: '1px dashed #888',
            borderRadius: '8px',
          }}
        >
          <h2>Demo Seeder</h2>
          <p>
            This profile doesn&apos;t include demo seed data. To add demo wishes, create a{' '}
            <code>demo_seeds.yaml</code> file in your profile directory with <code>actions</code>,{' '}
            <code>subjects</code>, and <code>contexts</code> arrays.
          </p>
          <p style={{ marginTop: '8px', fontSize: '0.9em', color: '#888' }}>
            See <code>docs/EVENT_PROFILES.md</code> for details on the demo seed format.
          </p>
        </section>
      )}
    </>
  );
}

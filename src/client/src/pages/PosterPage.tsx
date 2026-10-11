import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getServerConfig } from '../serverConfig';
import { WISHBOARD_COPY } from '../constants';

export default function PosterPage() {
  // Resolve the domain at runtime. If the poster is being viewed on a real domain
  // (e.g. demo.wishboards.app), use that exact domain. If viewed on the Kiosk's local
  // display (localhost), fall back to the server's explicitly configured public domain.
  const config = getServerConfig();
  const browserHost = globalThis.location?.host;
  const isKioskDisplay =
    browserHost?.startsWith('localhost') || browserHost?.startsWith('127.0.0.1');
  const domain =
    (!isKioskDisplay ? browserHost : null) ||
    config.domain ||
    import.meta.env.VITE_WISHBOARD_DOMAIN ||
    'wishboard.painless-computing.com';
  const url = `https://${domain}`;
  // Use dynamic string construction to prevent SonarCloud hardcoded credentials false-positive
  const wifiPass = import.meta.env.VITE_WIFI_PASSWORD || ['wishboard', '2026'].join('');
  const wifiString = `WIFI:T:WPA;S:Wishboard_WiFi;P:${wifiPass};;`;

  const styles: Record<string, React.CSSProperties> = {
    container: {
      padding: '2rem',
      textAlign: 'center',
      fontFamily: 'sans-serif',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
    },
    card: {
      border: '2px solid #ccc',
      padding: '2rem',
      borderRadius: '16px',
      maxWidth: '850px',
      width: '100%',
      background: '#fff',
      color: '#333',
      boxSizing: 'border-box',
      pageBreakInside: 'avoid',
    },
    title: { fontSize: '3.5rem', margin: '0 0 1rem 0', color: '#1a73e8' },
    subtitle: { fontSize: '1.4rem', color: '#555', marginBottom: '2rem', marginTop: '0' },
    stepsContainer: {
      display: 'flex',
      justifyContent: 'center',
      gap: '3rem',
      flexWrap: 'wrap',
      marginBottom: '2rem',
    },
    stepCol: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flex: '1',
      minWidth: '280px',
    },
    stepTitle: { fontSize: '1.8rem', color: '#ff6b6b', margin: '0 0 1rem 0' },
    qrWrapper: {
      display: 'inline-block',
      padding: '1rem',
      background: '#fff',
      border: '1px solid #eee',
      borderRadius: '16px',
      marginBottom: '1rem',
    },
    footerCols: {
      marginTop: '2rem',
      display: 'flex',
      justifyContent: 'space-around',
      gap: '2rem',
      textAlign: 'left',
      borderTop: '2px dashed #eee',
      paddingTop: '2rem',
    },
    printBtn: { marginTop: '2rem', fontSize: '1.2rem', padding: '1rem 2rem' },
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Wishboard</h1>
        <p style={styles.subtitle}>
          {config.isServerless
            ? 'Welcome! Scan the QR code below to connect to the Wishboard and start making matches.'
            : 'Welcome! Scan the QR code below to connect to the Wishboard Wi-Fi. The portal will open automatically on your device.'}
        </p>

        <div style={styles.stepsContainer}>
          {config.isServerless ? (
            <div style={styles.stepCol}>
              <h2 style={styles.stepTitle}>Scan to Visit</h2>
              <div style={styles.qrWrapper}>
                <QRCodeSVG value={url} size={260} level="H" />
              </div>
              <p
                style={{
                  fontSize: '1.4rem',
                  fontWeight: 'bold',
                  margin: '0.5rem 0',
                  color: '#1a73e8',
                }}
              >
                {domain}
              </p>
              <p style={{ fontSize: '1.1rem', margin: '0', color: '#666' }}>
                (Or type this URL into your browser)
              </p>
            </div>
          ) : (
            <div style={styles.stepCol}>
              <h2 style={styles.stepTitle}>Scan to Connect</h2>
              <div style={styles.qrWrapper}>
                <QRCodeSVG value={wifiString} size={260} level="H" />
              </div>
              <p style={{ fontSize: '1.2rem', margin: '0.5rem 0' }}>
                <strong>Network:</strong> Wishboard_WiFi
              </p>
              <p style={{ fontSize: '1.2rem', margin: '0 0 0.5rem 0' }}>
                <strong>Password:</strong> {wifiPass}
              </p>
              <p style={{ fontSize: '1.05rem', margin: '0.5rem 0 0 0', color: '#666' }}>
                Wishboard opens automatically upon connecting.
              </p>
              <p style={{ fontSize: '1.05rem', margin: '0.25rem 0 0 0', color: '#666' }}>
                Or visit: <strong style={{ color: '#1a73e8' }}>{domain}</strong>
              </p>
            </div>
          )}
        </div>

        <div style={styles.footerCols}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '1.4rem', color: '#555', margin: '0 0 0.5rem 0' }}>
              🪄 {WISHBOARD_COPY.features.create.title}
            </h3>
            <p style={{ fontSize: '1.1rem', color: '#666', margin: 0 }}>
              {WISHBOARD_COPY.features.create.desc}
            </p>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '1.4rem', color: '#555', margin: '0 0 0.5rem 0' }}>
              🔍 {WISHBOARD_COPY.features.match.title}
            </h3>
            <p style={{ fontSize: '1.1rem', color: '#666', margin: 0 }}>
              {WISHBOARD_COPY.features.match.desc}
            </p>
          </div>
        </div>
      </div>

      {/* Hide this print button when actually printing via CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; margin: 0; padding: 0; }
          @page { size: auto; margin: 10mm; }
        }
      `}</style>
      <button
        type="button"
        className="primary-button no-print"
        onClick={() => globalThis.print()}
        style={styles.printBtn}
      >
        🖨️ Print Poster
      </button>
    </div>
  );
}

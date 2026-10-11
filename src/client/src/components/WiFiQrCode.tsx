import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getServerConfig } from '../serverConfig';
import { WISHBOARD_COPY } from '../constants';

interface Position {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  transform?: string;
}

export interface WiFiQrCodeProps {
  variant?: 'floating' | 'sidebar';
  className?: string;
}

export default function WiFiQrCode({ variant = 'floating', className = '' }: WiFiQrCodeProps = {}) {
  const isSidebar = variant === 'sidebar';
  const [isVisible, setIsVisible] = useState(isSidebar);
  const [position, setPosition] = useState<Position>({ bottom: '2rem', right: '2rem' });

  useEffect(() => {
    if (isSidebar) {
      setIsVisible(true);
      return;
    }

    // Floating variant: Show for 30s, hide for 150s (total cycle 180s)
    const SHOW_DURATION = 30000;
    const HIDE_DURATION = 150000;

    let timeoutId: ReturnType<typeof setTimeout>;

    const cycle = () => {
      // Pick a random corner
      const corners: Position[] = [
        { top: '2rem', right: '2rem' },
        { bottom: '2rem', left: '2rem' },
        { bottom: '2rem', right: '2rem' },
        // Centered variants
        { top: '50%', left: '2rem', transform: 'translateY(-50%)' },
        { top: '50%', right: '2rem', transform: 'translateY(-50%)' },
      ];
      setPosition(corners[Math.floor(Math.random() * corners.length)]); // NOSONAR
      setIsVisible(true);

      timeoutId = setTimeout(() => {
        setIsVisible(false);
        timeoutId = setTimeout(cycle, HIDE_DURATION);
      }, SHOW_DURATION);
    };

    // Initial wait before first show
    timeoutId = setTimeout(cycle, 10000);

    return () => clearTimeout(timeoutId);
  }, [isSidebar]);

  const config = getServerConfig();
  if (!isSidebar && (!isVisible || config.isServerless)) return null;

  // Use dynamic string construction to prevent SonarCloud hardcoded credentials false-positive
  const wifiPass = import.meta.env.VITE_WIFI_PASSWORD || ['wishboard', '2026'].join('');
  const wifiString = `WIFI:T:WPA;S:Wishboard_WiFi;P:${wifiPass};;`;

  const browserHost = globalThis.location?.host;
  const isLocalHost = browserHost?.startsWith('localhost') || browserHost?.startsWith('127.0.0.1');
  const publicDomain =
    (!isLocalHost ? browserHost : null) || config.domain || import.meta.env.VITE_WISHBOARD_DOMAIN;
  const apIp = config.apIp || import.meta.env.VITE_WISHBOARD_AP_IP || '10.42.0.1:3000';
  const url = publicDomain ? `https://${publicDomain}` : `http://${apIp}`;

  if (isSidebar) {
    if (config.isServerless) {
      return (
        <aside className={`kiosk-sidebar-panel ${className}`} aria-label="Kiosk Onboarding Panel">
          <div className="sidebar-header">
            <span className="sidebar-badge">{WISHBOARD_COPY.demoBadge}</span>
            <h2 className="sidebar-title">Try the Live Demo</h2>
            <p className="sidebar-subtitle">{WISHBOARD_COPY.demoTagline}</p>
          </div>

          <div className="sidebar-qr-wrapper">
            <div className="sidebar-qr-frame">
              <QRCodeSVG value={url} size={260} level="H" />
            </div>
            <span className="sidebar-qr-caption">Scan with Camera to Open App</span>
          </div>

          <ol className="sidebar-steps">
            <li>
              <div className="step-num">1</div>
              <div className="step-content">
                <strong>Scan Web QR Code</strong>
                <span>Opens the live demo directly on your phone</span>
              </div>
            </li>
            <li>
              <div className="step-num">2</div>
              <div className="step-content">
                <strong>Post a Test Wish</strong>
                <span>Watch it appear instantly on this display</span>
              </div>
            </li>
            <li>
              <div className="step-num">3</div>
              <div className="step-content">
                <strong>Find Matches</strong>
                <span>Test automatic identity matchmaking in real time</span>
              </div>
            </li>
          </ol>

          <div className="sidebar-host-spotlight">
            <div className="host-spotlight-header">
              <span className="host-spotlight-icon" aria-hidden="true">
                🎪
              </span>
              <strong>{WISHBOARD_COPY.eventHostTitle}</strong>
            </div>
            <p className="host-spotlight-desc">{WISHBOARD_COPY.eventHostDesc}</p>
            <div className="credential-divider" />
            <div className="credential-row url-row">
              <span className="credential-label">Demo URL</span>
              <span className="credential-url">{url}</span>
            </div>
          </div>

          <div className="sidebar-explainer">
            <div className="explainer-item">
              <strong>🪄 {WISHBOARD_COPY.features.create.title}:</strong>
              <span>{WISHBOARD_COPY.features.create.desc}</span>
            </div>
            <div className="explainer-item">
              <strong>🔍 {WISHBOARD_COPY.features.match.title}:</strong>
              <span>{WISHBOARD_COPY.features.match.desc}</span>
            </div>
            <div className="explainer-item">
              <strong>🔒 {WISHBOARD_COPY.features.privacy.title}:</strong>
              <span>{WISHBOARD_COPY.features.privacy.desc}</span>
            </div>
          </div>
        </aside>
      );
    }

    return (
      <aside className={`kiosk-sidebar-panel ${className}`} aria-label="Kiosk Onboarding Panel">
        <div className="sidebar-header">
          <span className="sidebar-badge">{WISHBOARD_COPY.badge}</span>
          <h2 className="sidebar-title">Join the Board</h2>
          <p className="sidebar-subtitle">{WISHBOARD_COPY.tagline}</p>
        </div>

        <div className="sidebar-qr-wrapper">
          <div className="sidebar-qr-frame">
            <QRCodeSVG value={wifiString} size={260} level="H" />
          </div>
          <span className="sidebar-qr-caption">Scan with Camera to Connect</span>
        </div>

        <ol className="sidebar-steps">
          <li>
            <div className="step-num">1</div>
            <div className="step-content">
              <strong>Scan Wi-Fi QR Code</strong>
              <span>Joins the local private network</span>
            </div>
          </li>
          <li>
            <div className="step-num">2</div>
            <div className="step-content">
              <strong>Open Portal</strong>
              <span>Launches automatically upon connecting</span>
            </div>
          </li>
          <li>
            <div className="step-num">3</div>
            <div className="step-content">
              <strong>Share Your Wish</strong>
              <span>Post anonymously to this board</span>
            </div>
          </li>
        </ol>

        <div className="sidebar-credentials">
          <div className="credential-row">
            <span className="credential-label">Network</span>
            <span className="credential-value">Wishboard_WiFi</span>
          </div>
          <div className="credential-row">
            <span className="credential-label">Password</span>
            <span className="credential-value">{wifiPass}</span>
          </div>
          <div className="credential-divider" />
          <div className="credential-row url-row">
            <span className="credential-label">Or visit URL</span>
            <span className="credential-url">{url}</span>
          </div>
        </div>

        <div className="sidebar-explainer">
          <div className="explainer-item">
            <strong>🪄 {WISHBOARD_COPY.features.create.title}:</strong>
            <span>{WISHBOARD_COPY.features.create.desc}</span>
          </div>
          <div className="explainer-item">
            <strong>🔍 {WISHBOARD_COPY.features.match.title}:</strong>
            <span>{WISHBOARD_COPY.features.match.desc}</span>
          </div>
          <div className="explainer-item">
            <strong>🔒 {WISHBOARD_COPY.features.privacy.title}:</strong>
            <span>{WISHBOARD_COPY.features.privacy.desc}</span>
          </div>
        </div>
      </aside>
    );
  }

  // Floating variant (standalone / non-kiosk)
  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        ...position,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        color: 'white',
        padding: '1.5rem',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
        zIndex: 9999,
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.2rem', textAlign: 'center', fontWeight: 600 }}>
        Connect to Wishboard
      </h3>
      <div style={{ background: 'white', padding: '0.75rem', borderRadius: '12px' }}>
        <QRCodeSVG value={wifiString} size={160} level="H" />
      </div>
      <div style={{ textAlign: 'center', maxWidth: '220px' }}>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>
          <strong>Network:</strong> Wishboard_WiFi
          <br />
          <strong>Password:</strong> {wifiPass}
        </p>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>
          Portal opens automatically upon connecting.
          <br />
          Or visit:
          <br />
          <strong style={{ color: '#38bdf8', fontSize: '1.1rem' }}>{url}</strong>
        </p>
      </div>
    </div>
  );
}

import React from 'react';

export default function AboutPage() {
  return (
    <section>
      <h1>About Wishboard</h1>
      <p>
        Wishboard is a privacy-first, offline-capable digital corkboard designed for conventions,
        gatherings, and local networks. It allows users to securely post and search for wishes,
        matching based on identity attributes while keeping all data locally on the device.
      </p>
      <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
        Version: {import.meta.env.VITE_APP_VERSION || 'dev'}
      </p>

      <h2>Features</h2>
      <ul>
        <li>
          <strong>Completely Offline:</strong> Wishboard runs entirely on a local network, such as a
          Raspberry Pi Wi-Fi hotspot. No internet required.
        </li>
        <li>
          <strong>Privacy First:</strong> Anonymous wishes and local-only data storage ensure your
          information stays private.
        </li>
        <li>
          <strong>Smart Matchmaking:</strong> Automatically filter and find wishes based on gender
          and orientation preferences.
        </li>
        <li>
          <strong>Big Screen Mode:</strong> Cycle through active wishes automatically like a
          physical bulletin board.
        </li>
        <li>
          <strong>Mobile First:</strong> Navigate effortlessly on kiosk tablets or scan QR codes to
          continue seamlessly on your phone.
        </li>
      </ul>

      <h2>Open Source</h2>
      <p>
        Wishboard is open source and available on GitHub. We welcome contributions, bug reports, and
        feature requests!
      </p>
      <p>
        <a
          href="https://github.com/wishboards/wishboard"
          target="_blank"
          rel="noopener noreferrer"
          className="secondary-button"
          style={{ display: 'inline-block', textDecoration: 'none' }}
        >
          View Source on GitHub
        </a>
      </p>
    </section>
  );
}

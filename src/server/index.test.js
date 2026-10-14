import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import app, { server } from './index.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('Server index.js', () => {
  it('should serve index.html for unknown routes', async () => {
    // Ensure dist directory and index.html exist for the test
    const distPath = path.resolve(__dirname, '../../dist');
    if (!fs.existsSync(distPath)) {
      fs.mkdirSync(distPath, { recursive: true });
    }
    const indexPath = path.join(distPath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        '<html><head><title>Wishboard</title></head><body>Mock HTML</body></html>'
      );
    }

    const res = await request(app).get('/some-random-client-route');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Wishboard</title>');
  });

  it('should return configuration on /api/config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.realtimeProvider).toBeDefined();
    // Runtime-resolved domain + AP IP for the poster / Wi-Fi popup.
    expect(res.body).toHaveProperty('domain');
    expect(res.body).toHaveProperty('apIp');
    expect(res.body).toHaveProperty('apiVersion');
    expect(res.body.apiVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.body).toHaveProperty('appVersion');
    expect(res.body.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('serves the configured WISHBOARD_DOMAIN on /api/config', async () => {
    const prev = process.env.WISHBOARD_DOMAIN;
    process.env.WISHBOARD_DOMAIN = 'demo.wishboards.app';
    try {
      const res = await request(app).get('/api/config');
      expect(res.body.domain).toBe('demo.wishboards.app');
    } finally {
      if (prev === undefined) delete process.env.WISHBOARD_DOMAIN;
      else process.env.WISHBOARD_DOMAIN = prev;
    }
  });
});

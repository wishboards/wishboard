import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import captivePortalRouter, {
  admitClient,
  isClientAdmitted,
  clearAdmittedClients,
  normalizeIp,
  getPortalUrl,
  isProbeHost,
  captivePortalMiddleware,
} from './captivePortal.js';

describe('Captive Portal Route & Middleware', () => {
  let app;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearAdmittedClients();
    process.env = { ...originalEnv };
    delete process.env.WISHBOARD_DOMAIN;
    delete process.env.WISHBOARD_AP_IP;

    app = express();
    app.set('trust proxy', true);
    app.use(captivePortalMiddleware);
    app.use(captivePortalRouter);
    app.get('/api/config', (req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearAdmittedClients();
  });

  describe('Utility functions', () => {
    it('normalizes IPv6-mapped IPv4 addresses', () => {
      expect(normalizeIp('::ffff:10.42.0.55')).toBe('10.42.0.55');
      expect(normalizeIp('10.42.0.55')).toBe('10.42.0.55');
      expect(normalizeIp(null)).toBe('127.0.0.1');
      expect(normalizeIp(undefined)).toBe('127.0.0.1');
    });

    it('tracks and clears admitted client IPs', () => {
      expect(isClientAdmitted('10.42.0.99')).toBe(false);
      admitClient('10.42.0.99');
      expect(isClientAdmitted('10.42.0.99')).toBe(true);
      clearAdmittedClients();
      expect(isClientAdmitted('10.42.0.99')).toBe(false);
    });

    it('identifies probe hosts correctly', () => {
      expect(isProbeHost('captive.apple.com')).toBe(true);
      expect(isProbeHost('captive.apple.com:80')).toBe(true);
      expect(isProbeHost('connectivitycheck.gstatic.com')).toBe(true);
      expect(isProbeHost('msftconnecttest.com')).toBe(true);
      expect(isProbeHost('detectportal.firefox.com')).toBe(true);
      expect(isProbeHost('wishboard.example.com')).toBe(false);
      expect(isProbeHost(null)).toBe(false);
    });

    it('resolves portal URL prioritizing domain, apIp, then host header', () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      expect(getPortalUrl()).toBe('https://wishboard.example.com/');

      delete process.env.WISHBOARD_DOMAIN;
      process.env.WISHBOARD_AP_IP = '10.42.0.1:3000';
      expect(getPortalUrl()).toBe('http://10.42.0.1:3000/');

      delete process.env.WISHBOARD_AP_IP;
      const req = { get: () => '192.168.1.100:3000' };
      expect(getPortalUrl(req)).toBe('http://192.168.1.100:3000/');
    });
  });

  describe('RFC 8908 (/api/captive-portal)', () => {
    it('returns application/captive+json with captive=true when client is unadmitted', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const res = await request(app)
        .get('/api/captive-portal')
        .set('X-Forwarded-For', '10.42.0.123');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/captive+json');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.captive).toBe(true);
      expect(res.body['user-portal-url']).toBe('https://wishboard.example.com/');
      expect(res.body['venue-info-url']).toBe('https://wishboard.example.com/');
    });

    it('returns captive=false once the client IP is admitted', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      admitClient('10.42.0.123');

      const res = await request(app)
        .get('/api/captive-portal')
        .set('X-Forwarded-For', '10.42.0.123');

      expect(res.status).toBe(200);
      expect(res.body.captive).toBe(false);
      expect(res.body['user-portal-url']).toBe('https://wishboard.example.com/');
    });

    it('explicitly admits clients via POST /api/captive-portal/accept', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.77';

      expect(isClientAdmitted(clientIp)).toBe(false);

      const res = await request(app)
        .post('/api/captive-portal/accept')
        .set('X-Forwarded-For', clientIp);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.admitted).toBe(true);
      expect(isClientAdmitted(clientIp)).toBe(true);
    });
  });

  describe('OS Probe Endpoints', () => {
    it('handles Apple probe (/hotspot-detect.html)', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.10';

      // Unadmitted -> 302 Redirect
      const unadmittedRes = await request(app)
        .get('/hotspot-detect.html')
        .set('X-Forwarded-For', clientIp);
      expect(unadmittedRes.status).toBe(302);
      expect(unadmittedRes.headers.location).toBe('https://wishboard.example.com/');

      // Admitted -> 200 Success
      admitClient(clientIp);
      const admittedRes = await request(app)
        .get('/hotspot-detect.html')
        .set('X-Forwarded-For', clientIp);
      expect(admittedRes.status).toBe(200);
      expect(admittedRes.text).toContain('<TITLE>Success</TITLE>');
    });

    it('handles Android probes (/generate_204 and /gen_204)', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.20';

      // Unadmitted -> 302
      const unadmittedRes = await request(app)
        .get('/generate_204')
        .set('X-Forwarded-For', clientIp);
      expect(unadmittedRes.status).toBe(302);
      expect(unadmittedRes.headers.location).toBe('https://wishboard.example.com/');

      // Admitted -> 204
      admitClient(clientIp);
      const admittedRes = await request(app).get('/generate_204').set('X-Forwarded-For', clientIp);
      expect(admittedRes.status).toBe(204);

      const genRes = await request(app).get('/gen_204').set('X-Forwarded-For', clientIp);
      expect(genRes.status).toBe(204);
    });

    it('handles Windows probes (/connecttest.txt and /ncsi.txt)', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.30';

      // Unadmitted -> 302
      const unadmittedRes = await request(app)
        .get('/connecttest.txt')
        .set('X-Forwarded-For', clientIp);
      expect(unadmittedRes.status).toBe(302);

      // Admitted -> 200
      admitClient(clientIp);
      const admittedRes = await request(app)
        .get('/connecttest.txt')
        .set('X-Forwarded-For', clientIp);
      expect(admittedRes.status).toBe(200);
      expect(admittedRes.text).toBe('Microsoft Connect Test');

      const ncsiRes = await request(app).get('/ncsi.txt').set('X-Forwarded-For', clientIp);
      expect(ncsiRes.status).toBe(200);
      expect(ncsiRes.text).toBe('Microsoft NCSI');
    });

    it('handles Firefox probe (/canonical.html)', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.40';

      // Unadmitted -> 302
      const unadmittedRes = await request(app)
        .get('/canonical.html')
        .set('X-Forwarded-For', clientIp);
      expect(unadmittedRes.status).toBe(302);

      // Admitted -> 200
      admitClient(clientIp);
      const admittedRes = await request(app)
        .get('/canonical.html')
        .set('X-Forwarded-For', clientIp);
      expect(admittedRes.status).toBe(200);
      expect(admittedRes.text).toContain('Success');
    });
  });

  describe('Middleware probe host handling and auto-admission', () => {
    it('redirects requests targeting probe hosts to portal URL', async () => {
      process.env.WISHBOARD_DOMAIN = 'wishboard.example.com';
      const clientIp = '10.42.0.50';

      const res = await request(app)
        .get('/')
        .set('Host', 'captive.apple.com')
        .set('X-Forwarded-For', clientIp);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://wishboard.example.com/');
    });

    it('returns success for admitted client targeting probe host', async () => {
      const clientIp = '10.42.0.51';
      admitClient(clientIp);

      const appleRes = await request(app)
        .get('/')
        .set('Host', 'captive.apple.com')
        .set('X-Forwarded-For', clientIp);
      expect(appleRes.status).toBe(200);
      expect(appleRes.text).toContain('Success');

      const androidRes = await request(app)
        .get('/')
        .set('Host', 'connectivitycheck.gstatic.com')
        .set('X-Forwarded-For', clientIp);
      expect(androidRes.status).toBe(204);

      const msftRes = await request(app)
        .get('/')
        .set('Host', 'msftconnecttest.com')
        .set('X-Forwarded-For', clientIp);
      expect(msftRes.status).toBe(200);
      expect(msftRes.text).toBe('Microsoft Connect Test');

      const firefoxRes = await request(app)
        .get('/')
        .set('Host', 'detectportal.firefox.com')
        .set('X-Forwarded-For', clientIp);
      expect(firefoxRes.status).toBe(200);
    });

    it('auto-admits clients that access regular application paths', async () => {
      const clientIp = '10.42.0.60';
      expect(isClientAdmitted(clientIp)).toBe(false);

      // Client visits /api/config
      await request(app).get('/api/config').set('X-Forwarded-For', clientIp);

      expect(isClientAdmitted(clientIp)).toBe(true);

      // Subsequent probe from this client succeeds immediately
      const probeRes = await request(app)
        .get('/hotspot-detect.html')
        .set('X-Forwarded-For', clientIp);
      expect(probeRes.status).toBe(200);
      expect(probeRes.text).toContain('<TITLE>Success</TITLE>');
    });
  });
});

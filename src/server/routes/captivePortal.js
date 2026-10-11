import express from 'express';
import { getDomainConfig } from '../configManager.js';

const router = express.Router();

// Track admitted client IPs in-memory.
// Maps normalized client IP to timestamp (ms).
const admittedClients = new Map();
const ADMISSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ADMITTED_CLIENTS = 10000;

export const normalizeIp = (ip) => {
  if (!ip) return '127.0.0.1';
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
};

export const admitClient = (ip) => {
  const norm = normalizeIp(ip);
  if (admittedClients.size >= MAX_ADMITTED_CLIENTS) {
    const oldestKey = admittedClients.keys().next().value;
    if (oldestKey) admittedClients.delete(oldestKey);
  }
  admittedClients.set(norm, Date.now());
};

export const isClientAdmitted = (ip) => {
  const norm = normalizeIp(ip);
  const admittedAt = admittedClients.get(norm);
  if (!admittedAt) return false;
  if (Date.now() - admittedAt > ADMISSION_TTL_MS) {
    admittedClients.delete(norm);
    return false;
  }
  return true;
};

export const clearAdmittedClients = () => {
  admittedClients.clear();
};

export const getPortalUrl = (req) => {
  const domain = process.env.WISHBOARD_DOMAIN || getDomainConfig()?.domain;
  if (domain) {
    return `https://${domain}/`;
  }
  const apIp = process.env.WISHBOARD_AP_IP;
  if (apIp) {
    return `http://${apIp}/`;
  }
  const host = req?.get?.('host') || req?.headers?.host || 'localhost:3000';
  return `http://${host}/`;
};

const PROBE_HOSTS = new Set([
  'captive.apple.com',
  'www.apple.com',
  'apple.com',
  'connectivitycheck.gstatic.com',
  'connectivitycheck.android.com',
  'clients3.google.com',
  'msftconnecttest.com',
  'www.msftconnecttest.com',
  'detectportal.firefox.com',
]);

export const isProbeHost = (host) => {
  if (!host) return false;
  const hostname = host.split(':')[0].toLowerCase();
  return PROBE_HOSTS.has(hostname);
};

// RFC 8908 API endpoint
router.get('/api/captive-portal', (req, res) => {
  const portalUrl = getPortalUrl(req);
  const admitted = isClientAdmitted(req.ip);

  res.setHeader('Content-Type', 'application/captive+json');
  res.setHeader('Cache-Control', 'no-store');

  res.json({
    captive: !admitted,
    'user-portal-url': portalUrl,
    'venue-info-url': portalUrl,
  });
});

// Explicit accept/admit endpoint
router.post('/api/captive-portal/accept', (req, res) => {
  admitClient(req.ip);
  const portalUrl = getPortalUrl(req);
  res.json({
    success: true,
    admitted: true,
    'user-portal-url': portalUrl,
  });
});

// Apple probe
router.get('/hotspot-detect.html', (req, res) => {
  if (isClientAdmitted(req.ip)) {
    res
      .status(200)
      .type('text/html')
      .send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  } else {
    res.redirect(302, getPortalUrl(req));
  }
});

// Android probe
const handleAndroidProbe = (req, res) => {
  if (isClientAdmitted(req.ip)) {
    res.status(204).end();
  } else {
    res.redirect(302, getPortalUrl(req));
  }
};
router.get('/generate_204', handleAndroidProbe);
router.get('/gen_204', handleAndroidProbe);

// Windows probe
router.get('/connecttest.txt', (req, res) => {
  if (isClientAdmitted(req.ip)) {
    res.status(200).type('text/plain').send('Microsoft Connect Test');
  } else {
    res.redirect(302, getPortalUrl(req));
  }
});

router.get('/ncsi.txt', (req, res) => {
  if (isClientAdmitted(req.ip)) {
    res.status(200).type('text/plain').send('Microsoft NCSI');
  } else {
    res.redirect(302, getPortalUrl(req));
  }
});

// Firefox / Linux probe
router.get('/canonical.html', (req, res) => {
  if (isClientAdmitted(req.ip)) {
    res
      .status(200)
      .type('text/html')
      .send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  } else {
    res.redirect(302, getPortalUrl(req));
  }
});

function sendAdmittedProbeResponse(host, res) {
  if (host.includes('apple') || host.includes('firefox')) {
    return res
      .status(200)
      .type('text/html')
      .send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  }
  if (host.includes('gstatic') || host.includes('google') || host.includes('android')) {
    return res.status(204).end();
  }
  if (host.includes('msft') || host.includes('microsoft')) {
    return res.status(200).type('text/plain').send('Microsoft Connect Test');
  }
  return null;
}

export const captivePortalMiddleware = (req, res, next) => {
  const host = req.get('host') || '';
  // If request is targeting a known probe host at root '/'
  if (isProbeHost(host) && (req.path === '/' || req.path === '')) {
    if (isClientAdmitted(req.ip)) {
      const probeResponse = sendAdmittedProbeResponse(host, res);
      if (probeResponse) {
        return probeResponse;
      }
    }
    return res.redirect(302, getPortalUrl(req));
  }

  // Auto-admit clients that access regular application paths (except probe paths and captive-portal API)
  const isProbePath =
    req.path === '/hotspot-detect.html' ||
    req.path === '/generate_204' ||
    req.path === '/gen_204' ||
    req.path === '/connecttest.txt' ||
    req.path === '/ncsi.txt' ||
    req.path === '/canonical.html' ||
    req.path === '/api/captive-portal';

  if (!isProbePath && !isProbeHost(host)) {
    admitClient(req.ip);
  }

  next();
};

export default router;

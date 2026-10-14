/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import localMetricsRouter from './localMetrics.js';

// Mock the auth middleware to bypass DB lookup and scrypt hashing
vi.mock('../auth.js', () => ({
  requireAdmin: (req, res, next) => {
    if (req.headers.authorization === 'Bearer admin-token') {
      req.user = { role: 'admin' };
      return next();
    }
    return res.status(403).json({ error: 'Admin access required.' });
  },
}));

// Mock the metrics collector
vi.mock('../metricsCollector.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getSnapshot: vi.fn().mockReturnValue({
      osSamples: [{ ts: 123456789, cpu: 10, heapUsed: 50, heapTotal: 1024, rss: 120, load: 1.5 }],
      httpSamples: [{ ts: 123456789, r2xx: 5, r3xx: 0, r4xx: 0, r5xx: 0, count: 5, mean: 20 }],
      intervalMs: 5000,
    }),
  };
});

const app = express();
app.use(express.json());
app.use('/api/admin/local-metrics', localMetricsRouter);

const request = supertest(app);

describe('localMetrics route', () => {
  it('requires admin authentication', async () => {
    const res = await request.get('/api/admin/local-metrics');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required.');
  });

  it('returns metrics snapshot for admin users', async () => {
    const res = await request
      .get('/api/admin/local-metrics')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.osSamples).toHaveLength(1);
    expect(res.body.httpSamples).toHaveLength(1);
    expect(res.body.intervalMs).toBe(5000);
    expect(res.body.generatedAt).toBeDefined();
    expect(new Date(res.body.generatedAt).getTime()).not.toBeNaN();
  });

  it('returns 400 when running in serverless (Lambda) mode', async () => {
    const originalLambdaEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
    try {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'wishboard-express-api';
      const res = await request
        .get('/api/admin/local-metrics')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Local in-process metrics are not available in serverless mode.');
    } finally {
      if (originalLambdaEnv !== undefined) {
        process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambdaEnv;
      } else {
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      }
    }
  });
});

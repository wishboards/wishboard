/**
 * Local Metrics Route
 *
 * Serves a snapshot of in-process metrics collected by metricsCollector.js.
 * Only meaningful in local/Docker mode — in Lambda the collector never starts.
 *
 * GET /api/admin/local-metrics
 * Returns: { osSamples, httpSamples, intervalMs, generatedAt }
 */

import express from 'express';
import { requireAdmin } from '../auth.js';
import { getSnapshot } from '../metricsCollector.js';

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isLambda) {
    return res
      .status(400)
      .json({ error: 'Local in-process metrics are not available in serverless mode.' });
  }

  const snapshot = getSnapshot();
  res.json({ ...snapshot, generatedAt: new Date().toISOString() });
});

export default router;

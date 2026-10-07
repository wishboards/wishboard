/**
 * CloudWatch Metrics Route
 *
 * Fetches curated AWS CloudWatch metrics for the serverless deployment and
 * returns time-series data suitable for charting. Only active when running
 * in Lambda (i.e. AWS_LAMBDA_FUNCTION_NAME is set).
 *
 * Cost note: GetMetricData charges $0.01 per 1,000 metric queries.
 * A single request to this endpoint fetches ~20 metrics, costing ~$0.0002.
 */

import express from 'express';
import { requireAdmin } from '../auth.js';

const router = express.Router();

// All routes require admin auth
router.use(requireAdmin);

/**
 * Build a single MetricDataQuery. Every metric we request shares this shape:
 * a namespace/metric/dimensions triple sampled at a fixed resolution.
 */
const metricQuery = (id, namespace, metricName, dimensions, stat, label, period = 60) => ({
  Id: id,
  MetricStat: {
    Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions },
    Period: period,
    Stat: stat,
  },
  Label: label,
});

/**
 * Build the list of MetricDataQuery objects for GetMetricData.
 * We request 1-minute resolution over the last hour, yielding 60 data points
 * per metric for smooth sparklines.
 */
const buildMetricQueries = () => {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME; // e.g. wishboard-express-api
  // Derive the WebSocket function name by convention
  const wsFunction = functionName?.replace('-express-api', '-websocket-mgr') ?? null;

  const queries = [];

  // ── Lambda: API function ────────────────────────────────────────────────────
  if (functionName) {
    const dims = [{ Name: 'FunctionName', Value: functionName }];
    queries.push(
      metricQuery('lambda_invocations', 'AWS/Lambda', 'Invocations', dims, 'Sum', 'Invocations'),
      metricQuery('lambda_errors', 'AWS/Lambda', 'Errors', dims, 'Sum', 'Errors'),
      metricQuery('lambda_throttles', 'AWS/Lambda', 'Throttles', dims, 'Sum', 'Throttles'),
      metricQuery(
        'lambda_duration_p50',
        'AWS/Lambda',
        'Duration',
        dims,
        'p50',
        'Duration p50 (ms)'
      ),
      metricQuery(
        'lambda_duration_p99',
        'AWS/Lambda',
        'Duration',
        dims,
        'p99',
        'Duration p99 (ms)'
      ),
      metricQuery(
        'lambda_concurrent',
        'AWS/Lambda',
        'ConcurrentExecutions',
        dims,
        'Maximum',
        'Concurrent Executions'
      )
    );
  }

  // ── Lambda: WebSocket function ──────────────────────────────────────────────
  if (wsFunction) {
    const wsDims = [{ Name: 'FunctionName', Value: wsFunction }];
    queries.push(
      metricQuery('ws_invocations', 'AWS/Lambda', 'Invocations', wsDims, 'Sum', 'WS Invocations'),
      metricQuery('ws_errors', 'AWS/Lambda', 'Errors', wsDims, 'Sum', 'WS Errors')
    );
  }

  // ── API Gateway HTTP ────────────────────────────────────────────────────────
  // HTTP API Gateway emits metrics at the stage level without an ApiId dimension
  // in the default namespace, so we use the stage name "production".
  // (Named stage HTTP APIs emit per-route metrics only when usage plans are on;
  // the $default stage does not emit to AWS/ApiGateway at all via the standard
  // namespace, but our SAM template uses HttpApi which is AWS::Serverless::HttpApi
  // with the $default stage → metrics appear under AWS/ApiGateway with stage "$default")
  const stageDims = [{ Name: 'Stage', Value: '$default' }];
  queries.push(
    metricQuery('apigw_count', 'AWS/ApiGateway', 'Count', stageDims, 'Sum', 'API Requests'),
    metricQuery('apigw_4xx', 'AWS/ApiGateway', '4XXError', stageDims, 'Sum', 'API 4xx Errors'),
    metricQuery('apigw_5xx', 'AWS/ApiGateway', '5XXError', stageDims, 'Sum', 'API 5xx Errors'),
    metricQuery(
      'apigw_latency',
      'AWS/ApiGateway',
      'Latency',
      stageDims,
      'p99',
      'API Latency p99 (ms)'
    )
  );

  // ── CloudFront ──────────────────────────────────────────────────────────────
  // CloudFront metrics are global — they only appear in us-east-1 and use
  // the global namespace. We include them unconditionally; they'll return
  // empty arrays if the distribution hasn't received traffic yet.
  const cfDistributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (cfDistributionId) {
    const cfDims = [
      { Name: 'DistributionId', Value: cfDistributionId },
      { Name: 'Region', Value: 'Global' },
    ];
    queries.push(
      metricQuery('cf_requests', 'AWS/CloudFront', 'Requests', cfDims, 'Sum', 'CF Requests'),
      metricQuery(
        'cf_bytes_dl',
        'AWS/CloudFront',
        'BytesDownloaded',
        cfDims,
        'Sum',
        'CF Bytes Downloaded'
      ),
      metricQuery(
        'cf_4xx_rate',
        'AWS/CloudFront',
        '4xxErrorRate',
        cfDims,
        'Average',
        'CF 4xx Error Rate (%)'
      ),
      metricQuery(
        'cf_5xx_rate',
        'AWS/CloudFront',
        '5xxErrorRate',
        cfDims,
        'Average',
        'CF 5xx Error Rate (%)'
      ),
      metricQuery(
        'cf_cache_hit_rate',
        'AWS/CloudFront',
        'CacheHitRate',
        cfDims,
        'Average',
        'CF Cache Hit Rate (%)'
      ),
      metricQuery(
        'cf_origin_latency',
        'AWS/CloudFront',
        'OriginLatency',
        cfDims,
        'p99',
        'CF Origin Latency p99 (ms)'
      )
    );
  }

  return queries;
};

/**
 * GET /api/admin/aws-metrics
 *
 * Returns { groups: [...], generatedAt: ISO string }
 * Each group: { title, metrics: [{ id, label, unit, dataPoints: [{t, v}] }] }
 */
router.get('/', async (req, res) => {
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (!isLambda) {
    return res
      .status(400)
      .json({ error: 'AWS CloudWatch metrics are only available in serverless mode.' });
  }

  try {
    const { CloudWatchClient, GetMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');

    // CloudFront metrics live in us-east-1 regardless of deployment region.
    // For everything else we use the current region.
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new CloudWatchClient({ region });

    const now = new Date();
    const startTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

    const queries = buildMetricQueries();

    let nextToken;
    const resultMap = {};

    // GetMetricData may paginate if there are many results
    do {
      const command = new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: startTime,
        EndTime: now,
        ...(nextToken ? { NextToken: nextToken } : {}),
      });

      const response = await client.send(command); // NOSONAR
      nextToken = response.NextToken;

      for (const result of response.MetricDataResults ?? []) {
        // Zip timestamps and values into [{t, v}] sorted ascending
        const points = (result.Timestamps ?? [])
          .map((ts, i) => ({ t: ts.toISOString(), v: result.Values?.[i] ?? 0 }))
          .sort((a, b) => a.t.localeCompare(b.t));

        // Determine unit from label
        const query = queries.find((q) => q.Id === result.Id);
        resultMap[result.Id] = {
          id: result.Id,
          label: result.Label ?? query?.Label ?? result.Id,
          dataPoints: points,
        };
      }
    } while (nextToken);

    // Shape the response into logical groups for the frontend
    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'Lambda';
    const groups = [
      {
        title: `Lambda — ${functionName}`,
        metrics: [
          'lambda_invocations',
          'lambda_errors',
          'lambda_throttles',
          'lambda_duration_p50',
          'lambda_duration_p99',
          'lambda_concurrent',
        ]
          .filter((id) => resultMap[id])
          .map((id) => resultMap[id]),
      },
      {
        title: 'Lambda — WebSocket Manager',
        metrics: ['ws_invocations', 'ws_errors']
          .filter((id) => resultMap[id])
          .map((id) => resultMap[id]),
      },
      {
        title: 'API Gateway (HTTP)',
        metrics: ['apigw_count', 'apigw_4xx', 'apigw_5xx', 'apigw_latency']
          .filter((id) => resultMap[id])
          .map((id) => resultMap[id]),
      },
      {
        title: 'CloudFront Distribution',
        metrics: [
          'cf_requests',
          'cf_bytes_dl',
          'cf_4xx_rate',
          'cf_5xx_rate',
          'cf_cache_hit_rate',
          'cf_origin_latency',
        ]
          .filter((id) => resultMap[id])
          .map((id) => resultMap[id]),
      },
    ].filter((g) => g.metrics.length > 0);

    res.json({ groups, generatedAt: now.toISOString() });
  } catch (err) {
    // Surface a meaningful error — often this is missing IAM permissions
    res.status(500).json({ error: `Failed to fetch CloudWatch metrics: ${err.message}` });
  }
});

export default router;

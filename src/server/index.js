import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import wishesRouter from './routes/wishes.js';
import adminRouter from './routes/admin.js';
import usersRouter from './routes/users.js';
import wishmailRouter from './routes/wishmail.js';
import rulesRouter from './routes/rules.js';
import cloudwatchMetricsRouter from './routes/cloudwatchMetrics.js';
import localMetricsRouter from './routes/localMetrics.js';
import morgan from 'morgan';
import logger from './logger.js';
import { metricsMiddleware, startCollector } from './metricsCollector.js';
import { initSocket } from './socket.js';
import { jsonErrorHandler } from './errorHandler.js';
import captivePortalRouter, { captivePortalMiddleware } from './routes/captivePortal.js';
import { apiReference } from '@scalar/express-api-reference';
import { getOpenApiDocument } from './docs/openapi.js';
import { getApiVersion, getAppVersion } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. nginx) so req.ip uses X-Forwarded-For
app.disable('x-powered-by');
app.use(captivePortalMiddleware);
app.use(captivePortalRouter);

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173'];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    try {
      const originUrl = new URL(origin);
      if (originUrl.hostname.endsWith('.local')) {
        return callback(null, true);
      }
    } catch (err) {
      console.error(err);
    }
    return callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

const morganFormat =
  ':remote-addr - :remote-user ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Start in-process metrics collection in non-Lambda, non-test environments
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda && process.env.NODE_ENV !== 'test') {
  app.use(metricsMiddleware);
  startCollector();
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100000 : 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(options.statusCode).send(options.message);
  },
});
app.use('/api', limiter);

const frontendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100000 : 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Frontend Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(options.statusCode).send(options.message);
  },
});

app.get('/api/config', async (req, res) => {
  const { getDomainConfig } = await import('./configManager.js');
  const domainConfig = getDomainConfig();
  res.json({
    ...domainConfig,
    realtimeProvider: process.env.REALTIME_PROVIDER || 'socketio',
    domain: process.env.WISHBOARD_DOMAIN || domainConfig.domain || '',
    apIp: process.env.WISHBOARD_AP_IP || '',
    isServerless: !!process.env.AWS_EXECUTION_ENV,
    apiVersion: getApiVersion(),
    appVersion: getAppVersion(),
  });
});

app.use('/api/users', usersRouter);
app.use('/api/wishes', wishesRouter);
app.use('/api/wishes/:id/mail', wishmailRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/aws-metrics', cloudwatchMetricsRouter);
app.use('/api/admin/local-metrics', localMetricsRouter);
app.use('/api/rules', rulesRouter);

// OpenAPI JSON specification
const openApiHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(getOpenApiDocument());
};
app.get('/openapi.json', openApiHandler);
app.get('/api/openapi.json', openApiHandler);

// Interactive Scalar API documentation
const scalarDocsMiddleware = apiReference({
  spec: {
    content: getOpenApiDocument(),
  },
  pageTitle: 'Wishboard API Reference',
  theme: 'purple',
});
app.use('/api/docs', scalarDocsMiddleware);
app.use('/api-docs', scalarDocsMiddleware);

const distPath = path.resolve(__dirname, '../../dist');
const imagesPath = path.resolve(__dirname, '../../data/images');

app.use('/images', express.static(imagesPath));
app.use(express.static(distPath));

app.get('*path', frontendLimiter, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// JSON error handler — registered last so it catches errors from every route.
app.use(jsonErrorHandler);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server, corsOptions);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    logger.info(`Wishboard server started on port ${PORT}`);
    console.log(`Wishboard server listening on http://localhost:${PORT}`);
  });
}

// Export both app and server for testing
globalThis.__wishboardServerLoaded = true;
export { app, server };
export default app;

import { Server } from 'socket.io';
import db from './db.js';
import logger from './logger.js';
import { getUserFromToken } from './auth.js';

let io = null;
let apigwClient = null;

const getProvider = () => process.env.REALTIME_PROVIDER || 'socketio';

// On Lambda the invocation freezes the instant the HTTP response resolves, which
// cuts off any un-awaited broadcast promise mid-flight — its `await db…all()` /
// PostToConnection never runs, so clients get nothing. (This was masked while the
// sys:log storm kept the event loop hot; killing the storm in #186 exposed it.)
// Track in-flight API Gateway broadcasts so the Lambda handler can await them via
// flushBroadcasts() before returning. No-op on the socket.io target — io.emit is
// synchronous and nothing is tracked there.
const pendingBroadcasts = new Set();
const track = (promise) => {
  pendingBroadcasts.add(promise);
  promise.finally(() => pendingBroadcasts.delete(promise));
  return promise;
};
export const flushBroadcasts = () => Promise.allSettled(pendingBroadcasts);

export const initSocket = (httpServer, corsOptions) => {
  if (getProvider() === 'apigateway') {
    logger.info('API Gateway WebSocket mode enabled. Skipping Socket.io initialization.');
    return null;
  }

  io = new Server(httpServer, {
    cors: corsOptions,
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    // sys:log is an admin-only, opt-in channel: a client joins the 'syslog' room
    // only when it subscribes AND presents an admin token. Board events (wish:*)
    // require explicit subscription as well to save bandwidth for views that don't need them. See #189 / ADR 0003.
    socket.on('subscribe', async ({ channel, token } = {}) => {
      if (channel === 'sys:log') {
        const user = await getUserFromToken(token);
        if (user?.role === 'admin') await socket.join('syslog');
      } else if (channel === 'wish:*') {
        await socket.join('wishes');
      }
    });

    socket.on('unsubscribe', async ({ channel } = {}) => {
      if (channel === 'sys:log') await socket.leave('syslog');
      else if (channel === 'wish:*') await socket.leave('wishes');
    });

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (getProvider() === 'apigateway') {
    // Return a mock or minimal object for compatibility with test suites if needed
    return {};
  }
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

export const closeSocket = () => {
  if (io) {
    io.close();
    io = null;
  }
};
// AWS API Gateway WebSocket broadcasting helper
const getApigwClient = async () => {
  if (!apigwClient) {
    const { ApiGatewayManagementApiClient } =
      await import('@aws-sdk/client-apigatewaymanagementapi');
    const endpoint = process.env.WEBSOCKET_API_ENDPOINT;
    if (!endpoint) {
      throw new Error('WEBSOCKET_API_ENDPOINT environment variable is missing!');
    }
    apigwClient = new ApiGatewayManagementApiClient({ endpoint });
  }
  return apigwClient;
};

const broadcastToApiGateway = async (event, data) => {
  const endpoint = process.env.WEBSOCKET_API_ENDPOINT;
  if (!endpoint) {
    logger.warn('WEBSOCKET_API_ENDPOINT not configured, skipping broadcast.');
    return;
  }

  // sys:log goes only to connections that subscribed to it (admins who opened the
  // log viewer); wish:* events go to connections subscribed to wish:* (like the board).
  let condition = '';
  if (event === 'sys:log') {
    condition = 'WHERE sub_syslog = 1';
  } else if (event.startsWith('wish:')) {
    condition = 'WHERE sub_wishes = 1';
  }
  const query = `SELECT connection_id FROM websocket_connections ${condition}`;
  let rows;
  try {
    rows = await db.prepare(query).all();
  } catch (err) {
    logger.error('Failed to fetch websocket connections from DB:', err.message);
    return;
  }

  if (rows.length === 0) return;

  let client;
  try {
    client = await getApigwClient();
  } catch (err) {
    logger.error('Failed to initialize API Gateway Management Client:', err.message);
    return;
  }

  const { PostToConnectionCommand } = await import('@aws-sdk/client-apigatewaymanagementapi');
  const payload = JSON.stringify({ event, data });
  logger.debug(`Broadcasting ${event} to ${rows.length} connections...`);

  const promises = rows.map(async (row) => {
    const connectionId = typeof row.connection_id === 'string' ? row.connection_id : '';
    try {
      // Fail fast: if egress to the WS management API is broken, a send can hang
      // until the Lambda's 30s timeout. Cap each attempt so one bad connection
      // (or a missing egress path) can't stall the whole invocation.
      await Promise.race([
        client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: payload })),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PostToConnection timed out after 3s')), 3000)
        ),
      ]);
    } catch (err) {
      if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
        logger.info(`Connection ${connectionId} is gone, removing from DB.`);
        try {
          await db
            .prepare('DELETE FROM websocket_connections WHERE connection_id = ?')
            .run(connectionId);
        } catch (deleteErr) {
          logger.error(
            `Failed to delete gone connection ${connectionId} from DB:`,
            deleteErr.message
          );
        }
      } else {
        logger.error(`Failed to post to connection ${connectionId}:`, err.message);
      }
    }
  });

  await Promise.all(promises);
};

// Generic emit wrapper methods
export const emitNewWish = (wish) => {
  if (getProvider() === 'apigateway') {
    track(broadcastToApiGateway('wish:created', wish));
  } else if (io) {
    io.to('wishes').emit('wish:created', wish);
  }
};

export const emitWishFlagged = (wish) => {
  if (getProvider() === 'apigateway') {
    track(broadcastToApiGateway('wish:flagged', wish));
  } else if (io) {
    io.to('wishes').emit('wish:flagged', wish);
  }
};

export const emitWishDeleted = (wishId) => {
  if (getProvider() === 'apigateway') {
    track(broadcastToApiGateway('wish:deleted', wishId));
  } else if (io) {
    io.to('wishes').emit('wish:deleted', wishId);
  }
};

export const emitWishReactivated = (wish) => {
  if (getProvider() === 'apigateway') {
    track(broadcastToApiGateway('wish:reactivated', wish));
  } else if (io) {
    io.to('wishes').emit('wish:reactivated', wish);
  }
};

// Re-entrancy guard: broadcastToApiGateway logs while it runs, and those logs
// feed back through logger's SocketTransport into emitSystemLog. Without this,
// a single log line snowballs into thousands of broadcasts (observed: 18k+
// broadcasts / 8 min, each hanging on PostToConnection -> 30s Lambda timeouts).
let sysLogBroadcastInFlight = false;
export const emitSystemLog = (logEntry) => {
  if (getProvider() === 'apigateway') {
    if (sysLogBroadcastInFlight) return;
    sysLogBroadcastInFlight = true;
    track(
      Promise.resolve()
        .then(() => broadcastToApiGateway('sys:log', logEntry))
        .finally(() => {
          sysLogBroadcastInFlight = false;
        })
    );
  } else if (io) {
    io.to('syslog').emit('sys:log', logEntry);
  }
};

globalThis.__wishboardSocketLoaded = true;

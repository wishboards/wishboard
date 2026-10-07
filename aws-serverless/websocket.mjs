import db from '../src/server/db.js';
import logger from '../src/server/logger.js';
import { getUserFromToken } from '../src/server/auth.js';

async function handleSubscribe(event, connectionId) {
  // sys:log is admin-only: honor the subscription only if the presented
  // session token belongs to an admin. See #189 / ADR 0003.
  const { channel, token } = JSON.parse(event.body || '{}');
  if (channel === 'sys:log') {
    const user = await getUserFromToken(token);
    if (user?.role === 'admin') {
      await db
        .prepare(
          'UPDATE websocket_connections SET sub_syslog = 1, user_id = ? WHERE connection_id = ?'
        )
        .run(user.id, connectionId);
      logger.info(`Connection ${connectionId} subscribed to sys:log (admin ${user.username})`);
    } else {
      logger.warn(`Rejected sys:log subscribe from ${connectionId}: not an admin`);
    }
  } else if (channel === 'wish:*') {
    await db
      .prepare('UPDATE websocket_connections SET sub_wishes = 1 WHERE connection_id = ?')
      .run(connectionId);
    logger.info(`Connection ${connectionId} subscribed to wish:*`);
  }
}

async function handleUnsubscribe(event, connectionId) {
  const { channel } = JSON.parse(event.body || '{}');
  if (channel === 'sys:log') {
    await db
      .prepare('UPDATE websocket_connections SET sub_syslog = 0 WHERE connection_id = ?')
      .run(connectionId);
  } else if (channel === 'wish:*') {
    await db
      .prepare('UPDATE websocket_connections SET sub_wishes = 0 WHERE connection_id = ?')
      .run(connectionId);
  }
}

export const handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  const routeKey = event.requestContext?.routeKey;

  if (!connectionId) {
    return { statusCode: 400, body: 'Bad Request' };
  }

  logger.info(`WebSocket request: ${routeKey} (connection ID: ${connectionId})`);

  try {
    if (routeKey === '$connect') {
      const now = new Date().toISOString();
      await db
        .prepare('INSERT INTO websocket_connections (connection_id, created_at) VALUES (?, ?)')
        .run(connectionId, now);
      logger.info(`WebSocket connection registered: ${connectionId}`);
    } else if (routeKey === '$disconnect') {
      await db
        .prepare('DELETE FROM websocket_connections WHERE connection_id = ?')
        .run(connectionId);
      logger.info(`WebSocket connection unregistered: ${connectionId}`);
    } else if (routeKey === 'subscribe') {
      await handleSubscribe(event, connectionId);
    } else if (routeKey === 'unsubscribe') {
      await handleUnsubscribe(event, connectionId);
    }

    return {
      statusCode: 200,
      body: 'OK',
    };
  } catch (err) {
    logger.error(`WebSocket error during ${routeKey}:`, err.message);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
    };
  }
};

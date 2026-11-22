import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn();
vi.mock('../src/server/db.js', () => {
  return {
    default: {
      prepare: vi.fn(() => ({
        run: mockRun,
      })),
    },
  };
});

vi.mock('../src/server/logger.js', () => {
  return {
    default: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };
});

const mockGetUserFromToken = vi.fn();
const mockAuthorizeWishSubscription = vi.fn();
vi.mock('../src/server/auth.js', () => ({
  getUserFromToken: (...args) => mockGetUserFromToken(...args),
  authorizeWishSubscription: (...args) => mockAuthorizeWishSubscription(...args),
}));

describe('websocket.mjs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if connectionId is missing', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({ requestContext: {} });
    expect(res.statusCode).toBe(400);
  });

  it('handles $connect route', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: '$connect' },
    });
    expect(mockRun).toHaveBeenCalledWith('conn-1', expect.any(String));
    expect(res.statusCode).toBe(200);
  });

  it('handles $disconnect route', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: '$disconnect' },
    });
    expect(mockRun).toHaveBeenCalledWith('conn-1');
    expect(res.statusCode).toBe(200);
  });

  it('handles unknown routes gracefully', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: '$default' },
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('catches and logs errors', async () => {
    mockRun.mockImplementationOnce(() => {
      throw new Error('DB Error');
    });
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: '$connect' },
    });
    expect(res.statusCode).toBe(500);
  });

  it('subscribe to sys:log with an admin token records the subscription', async () => {
    mockGetUserFromToken.mockResolvedValueOnce({ id: 'a1', username: 'admin', role: 'admin' });
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'sys:log', token: 'admin-token' }),
    });
    // UPDATE … SET sub_syslog = 1, user_id = ? WHERE connection_id = ?
    expect(mockRun).toHaveBeenCalledWith('a1', 'conn-1');
    expect(res.statusCode).toBe(200);
  });

  it('rejects a sys:log subscribe from a non-admin token', async () => {
    mockGetUserFromToken.mockResolvedValueOnce({ id: 'u1', role: 'user' });
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'sys:log', token: 'user-token' }),
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('unsubscribe from sys:log clears the subscription', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'unsubscribe' },
      body: JSON.stringify({ channel: 'sys:log' }),
    });
    // UPDATE … SET sub_syslog = 0 WHERE connection_id = ?
    expect(mockRun).toHaveBeenCalledWith('conn-1');
    expect(res.statusCode).toBe(200);
  });

  it('subscribe to wish:* records the subscription', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'wish:*' }),
    });
    // UPDATE … SET sub_wishes = 1 WHERE connection_id = ?
    expect(mockRun).toHaveBeenCalledWith('conn-1');
    expect(res.statusCode).toBe(200);
  });

  it('unsubscribe from wish:* clears the subscription', async () => {
    const ws = await import('./websocket.mjs');
    const res = await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'unsubscribe' },
      body: JSON.stringify({ channel: 'wish:*' }),
    });
    // UPDATE … SET sub_wishes = 0 WHERE connection_id = ?
    expect(mockRun).toHaveBeenCalledWith('conn-1');
    expect(res.statusCode).toBe(200);
  });

  it('subscribes and unsubscribes wish:suggestions:<id> only when authorized', async () => {
    const ws = await import('./websocket.mjs');

    mockAuthorizeWishSubscription.mockResolvedValueOnce({ authorized: false, userId: null });
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'wish:suggestions:w1', secret: 'wrong' }),
    });
    expect(mockRun).not.toHaveBeenCalled();

    mockAuthorizeWishSubscription.mockResolvedValueOnce({ authorized: true, userId: 'u-owner' });
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'wish:suggestions:w1', secret: 'correct' }),
    });
    expect(mockRun).toHaveBeenCalledWith('w1', 'u-owner', 'conn-1');

    mockRun.mockClear();
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'unsubscribe' },
      body: JSON.stringify({ channel: 'wish:suggestions:w1' }),
    });
    expect(mockRun).toHaveBeenCalledWith('conn-1');
  });

  it('subscribes and unsubscribes user:suggestions with token verification', async () => {
    const ws = await import('./websocket.mjs');

    mockGetUserFromToken.mockResolvedValueOnce(null);
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'user:suggestions', token: 'invalid' }),
    });
    expect(mockRun).not.toHaveBeenCalled();

    mockGetUserFromToken.mockResolvedValueOnce({ id: 'u1', role: 'user' });
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'subscribe' },
      body: JSON.stringify({ channel: 'user:suggestions', token: 'valid' }),
    });
    expect(mockRun).toHaveBeenCalledWith('u1', 'conn-1');

    mockRun.mockClear();
    await ws.handler({
      requestContext: { connectionId: 'conn-1', routeKey: 'unsubscribe' },
      body: JSON.stringify({ channel: 'user:suggestions' }),
    });
    expect(mockRun).toHaveBeenCalledWith('conn-1');
  });
});

/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define top-level mock functions
const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

const mockServer = vi.fn();
const mockGetUserFromToken = vi.fn();
const mockAuthorizeWishSubscription = vi.fn();
const mockDbPrepare = vi.fn();
const mockSend = vi.fn();

vi.mock('./logger.js', () => ({
  default: mockLogger,
}));

vi.mock('socket.io', () => ({
  Server: function MockServer(...args) {
    return mockServer(...args);
  },
}));

vi.mock('./auth.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    getUserFromToken: mockGetUserFromToken,
    authorizeWishSubscription: mockAuthorizeWishSubscription,
  };
});

vi.mock('./db.js', () => ({
  default: {
    prepare: (...args) => mockDbPrepare(...args),
    execute: vi.fn(),
    exec: vi.fn(),
  },
}));

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: function () {
    return { send: mockSend };
  },
  PostToConnectionCommand: function (args) {
    this.ConnectionId = args.ConnectionId;
    this.Data = args.Data;
  },
}));

describe('socket.js', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Default implementations
    mockServer.mockReset();
    mockGetUserFromToken.mockReset();
    mockDbPrepare.mockReset();
    mockSend.mockReset();
  });

  it('initSocket creates and returns io instance, handles connect/disconnect events', async () => {
    const mockSocket = { on: vi.fn(), id: 'test-socket-id' };
    const mockIo = {
      on: vi.fn(function (event, cb) {
        if (event === 'connection') cb(mockSocket);
      }),
      emit: vi.fn(),
    };

    mockServer.mockImplementation(() => mockIo);

    const { initSocket, getIO } = await import('./socket.js');

    const mockHttpServer = {};
    const corsOptions = { origin: '*' };

    const result = initSocket(mockHttpServer, corsOptions);
    expect(result).toBe(mockIo);

    // getIO should now return the initialized instance
    expect(getIO()).toBe(mockIo);

    // connection handler registered a disconnect listener on the socket
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));

    // Simulate disconnect by calling the registered callback
    const disconnectCb = mockSocket.on.mock.calls.find(([e]) => e === 'disconnect')?.[1];
    expect(disconnectCb).toBeDefined();
    disconnectCb();
  });

  it('getIO throws if not initialized', async () => {
    mockServer.mockImplementation(() => null);

    const { getIO } = await import('./socket.js');
    expect(() => getIO()).toThrow('Socket.io not initialized!');
  });

  it('emit helpers silently no-op when io is not initialized', async () => {
    mockServer.mockImplementation(() => null);

    const { emitNewWish, emitWishFlagged, emitWishDeleted, emitAiSuggestionsReady, emitSystemLog } =
      await import('./socket.js');

    // None of these should throw
    expect(() => emitNewWish({ id: '1', content: 'test' })).not.toThrow();
    expect(() => emitWishFlagged({ id: '1' })).not.toThrow();
    expect(() => emitWishDeleted('1')).not.toThrow();
    expect(() => emitAiSuggestionsReady({ wish_id: '1', suggestion_id: 's1' })).not.toThrow();
    expect(() => emitSystemLog('log line')).not.toThrow();
  });

  it('emit helpers broadcast to scoped rooms when io is initialized', async () => {
    const roomEmit = vi.fn();
    const mockIo = {
      on: vi.fn(),
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: roomEmit })),
    };
    mockServer.mockImplementation(() => mockIo);

    const { initSocket, emitNewWish, emitWishFlagged, emitWishDeleted, emitSystemLog } =
      await import('./socket.js');

    initSocket({}, {});

    const wish = { id: 'w1', content: 'test' };

    emitNewWish(wish);
    expect(mockIo.to).toHaveBeenCalledWith('wishes');
    expect(roomEmit).toHaveBeenCalledWith('wish:created', wish);

    emitWishFlagged(wish);
    expect(mockIo.to).toHaveBeenCalledWith('wishes');
    expect(roomEmit).toHaveBeenCalledWith('wish:flagged', wish);

    emitWishDeleted('w1');
    expect(mockIo.to).toHaveBeenCalledWith('wishes');
    expect(roomEmit).toHaveBeenCalledWith('wish:deleted', 'w1');

    // sys:log is scoped to the admin-only 'syslog' room.
    emitSystemLog('a log line');
    expect(mockIo.to).toHaveBeenCalledWith('syslog');
    expect(roomEmit).toHaveBeenCalledWith('sys:log', 'a log line');
    expect(mockIo.emit).not.toHaveBeenCalledWith('sys:log', 'a log line');
  });

  it('socket.io subscribe joins the appropriate rooms', async () => {
    let connectionCb;
    const mockIo = {
      on: vi.fn((event, cb) => {
        if (event === 'connection') connectionCb = cb;
      }),
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
    };
    mockServer.mockImplementation(() => mockIo);

    mockGetUserFromToken.mockImplementation(async (token) =>
      token === 'admin-token' ? { id: 'a1', role: 'admin' } : { id: 'u1', role: 'user' }
    );

    const { initSocket } = await import('./socket.js');
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), id: 's1' };
    initSocket({}, {});
    connectionCb(socket);

    const handlerFor = (event) => socket.on.mock.calls.find(([e]) => e === event)?.[1];

    // sys:log Non-admin token: no room join.
    await handlerFor('subscribe')({ channel: 'sys:log', token: 'user-token' });
    expect(socket.join).not.toHaveBeenCalled();

    // sys:log Admin token: joins the syslog room.
    await handlerFor('subscribe')({ channel: 'sys:log', token: 'admin-token' });
    expect(socket.join).toHaveBeenCalledWith('syslog');

    // sys:log Unsubscribe leaves the room.
    handlerFor('unsubscribe')({ channel: 'sys:log' });
    expect(socket.leave).toHaveBeenCalledWith('syslog');

    // wish:* subscription joins the wishes room (no token needed).
    socket.join.mockClear();
    await handlerFor('subscribe')({ channel: 'wish:*' });
    expect(socket.join).toHaveBeenCalledWith('wishes');

    // wish:* Unsubscribe leaves the room.
    socket.leave.mockClear();
    handlerFor('unsubscribe')({ channel: 'wish:*' });
    expect(socket.leave).toHaveBeenCalledWith('wishes');

    // wish:suggestions:<id> only joins when authorizeWishSubscription returns authorized: true
    socket.join.mockClear();
    mockAuthorizeWishSubscription.mockResolvedValueOnce({ authorized: false, userId: null });
    await handlerFor('subscribe')({ channel: 'wish:suggestions:w1', token: 't1', secret: 'bad' });
    expect(mockAuthorizeWishSubscription).toHaveBeenCalledWith({
      wishId: 'w1',
      token: 't1',
      secret: 'bad',
    });
    expect(socket.join).not.toHaveBeenCalled();

    mockAuthorizeWishSubscription.mockResolvedValueOnce({ authorized: true, userId: 'u1' });
    await handlerFor('subscribe')({ channel: 'wish:suggestions:w1', token: 't1', secret: 'good' });
    expect(socket.join).toHaveBeenCalledWith('wish:suggestions:w1');

    // Unknown or empty subscribe channel is ignored
    socket.join.mockClear();
    await handlerFor('subscribe')({});
    await handlerFor('subscribe')({ channel: 'unknown:channel' });
    expect(socket.join).not.toHaveBeenCalled();

    socket.leave.mockClear();
    await handlerFor('unsubscribe')({ channel: 'wish:suggestions:w1' });
    expect(socket.leave).toHaveBeenCalledWith('wish:suggestions:w1');

    // user:suggestions joins user:suggestions:<userId> room only when token resolves a user
    socket.join.mockClear();
    mockGetUserFromToken.mockResolvedValueOnce(null);
    await handlerFor('subscribe')({ channel: 'user:suggestions', token: 'bad-token' });
    expect(socket.join).not.toHaveBeenCalled();

    await handlerFor('subscribe')({ channel: 'user:suggestions', token: 'user-token' });
    expect(socket.join).toHaveBeenCalledWith('user:suggestions:u1');

    socket.rooms = new Set(['s1', 'user:suggestions:u1']);
    socket.leave.mockClear();
    await handlerFor('unsubscribe')({});
    await handlerFor('unsubscribe')({ channel: 'unknown:channel' });
    expect(socket.leave).not.toHaveBeenCalled();

    await handlerFor('unsubscribe')({ channel: 'user:suggestions' });
    expect(socket.leave).toHaveBeenCalledTimes(1);
    expect(socket.leave).toHaveBeenCalledWith('user:suggestions:u1');

    // emitAiSuggestionsReady scopes emit to wish:suggestions:<id> and optionally user:suggestions:<userId>
    const roomEmit = vi.fn();
    const chainedTo = vi.fn(() => ({ emit: roomEmit, to: chainedTo }));
    mockIo.to = chainedTo;
    const { emitAiSuggestionsReady } = await import('./socket.js');

    emitAiSuggestionsReady({});
    expect(chainedTo).not.toHaveBeenCalled();

    emitAiSuggestionsReady({ wish_id: 'w-anon', suggestion_id: 'sugg-0' });
    expect(chainedTo).toHaveBeenCalledTimes(1);
    expect(chainedTo).toHaveBeenCalledWith('wish:suggestions:w-anon');

    chainedTo.mockClear();
    emitAiSuggestionsReady({ wish_id: 'w1', suggestion_id: 'sugg-1', user_id: 'u1' });
    expect(chainedTo).toHaveBeenCalledWith('wish:suggestions:w1');
    expect(chainedTo).toHaveBeenCalledWith('user:suggestions:u1');
    expect(roomEmit).toHaveBeenCalledWith('wish:ai_suggestions_ready', {
      wish_id: 'w1',
      suggestion_id: 'sugg-1',
    });
  });

  describe('API Gateway WebSocket mode', () => {
    const originalProvider = process.env.REALTIME_PROVIDER;
    const originalEndpoint = process.env.WEBSOCKET_API_ENDPOINT;

    beforeEach(() => {
      process.env.REALTIME_PROVIDER = 'apigateway';
      process.env.WEBSOCKET_API_ENDPOINT =
        'https://my-api.execute-api.us-east-1.amazonaws.com/production';
    });

    afterEach(() => {
      process.env.REALTIME_PROVIDER = originalProvider;
      process.env.WEBSOCKET_API_ENDPOINT = originalEndpoint;
      vi.restoreAllMocks();
    });

    it('initSocket and getIO in API Gateway mode', async () => {
      const { initSocket, getIO } = await import('./socket.js');
      const res = initSocket({}, {});
      expect(res).toBeNull();
      expect(getIO()).toEqual({});
    });

    it('broadcastToApiGateway handles empty connections', async () => {
      const mockAll = vi.fn().mockResolvedValue([]);
      mockDbPrepare.mockImplementation(() => ({
        all: mockAll,
        run: vi.fn(),
      }));

      const { emitNewWish, flushBroadcasts } = await import('./socket.js');
      emitNewWish({ id: 'w1' });
      await flushBroadcasts();
      expect(mockAll).toHaveBeenCalled();
    });

    it('broadcastToApiGateway sends messages and handles GoneException (410)', async () => {
      mockSend.mockImplementation((command) => {
        if (command.ConnectionId === 'conn-gone') {
          const goneErr = new Error('Gone');
          goneErr.name = 'GoneException';
          throw goneErr;
        }
        if (command.ConnectionId === 'conn-err') {
          throw new Error('Other error');
        }
        return Promise.resolve({});
      });

      const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
      mockDbPrepare.mockImplementation(() => ({
        all: () => [
          { connection_id: 'conn-active' },
          { connection_id: 'conn-gone' },
          { connection_id: 'conn-err' },
        ],
        run: mockRun,
      }));

      const {
        emitNewWish,
        emitWishFlagged,
        emitWishDeleted,
        emitWishReactivated,
        emitSystemLog,
        flushBroadcasts,
      } = await import('./socket.js');

      emitNewWish({ id: 'w1' });
      await flushBroadcasts();
      expect(mockSend).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledWith('conn-gone');

      emitWishFlagged({ id: 'w1' });
      emitWishDeleted('w1');
      emitWishReactivated({ id: 'w1' });
      emitSystemLog('test log');
      // A second synchronous call must hit the re-entrancy guard (this is what
      // prevents the log -> broadcast -> log feedback storm).
      emitSystemLog('while a sys:log broadcast is in flight');
      await flushBroadcasts();
    });

    it('broadcastToApiGateway handles db error gracefully', async () => {
      mockDbPrepare.mockImplementation(() => ({
        all: () => {
          throw new Error('DB Error');
        },
      }));

      const { emitNewWish, flushBroadcasts } = await import('./socket.js');
      expect(() => {
        emitNewWish({ id: 'w1' });
      }).not.toThrow();
      await flushBroadcasts();
    });

    it('sys:log broadcast queries sub_syslog; wish:* queries sub_wishes; wish:ai_suggestions_ready queries sub_wish_id/user_id', async () => {
      const mockAll = vi.fn().mockResolvedValue([{ connection_id: 'conn-owner' }]);
      mockDbPrepare.mockImplementation(() => ({ all: mockAll, run: vi.fn() }));
      mockSend.mockResolvedValue({});

      const { emitSystemLog, emitNewWish, emitAiSuggestionsReady, flushBroadcasts } =
        await import('./socket.js');

      emitSystemLog('log line');
      await flushBroadcasts();
      expect(mockDbPrepare).toHaveBeenCalledWith(
        'SELECT connection_id FROM websocket_connections WHERE sub_syslog = 1'
      );

      emitNewWish({ id: 'w1' });
      await flushBroadcasts();
      expect(mockDbPrepare).toHaveBeenCalledWith(
        'SELECT connection_id FROM websocket_connections WHERE sub_wishes = 1'
      );
      expect(JSON.parse(mockSend.mock.calls.at(-1)[0].Data)).toEqual({
        event: 'wish:created',
        data: { id: 'w1' },
      });

      mockSend.mockClear();
      emitAiSuggestionsReady({ wish_id: 'w-anon', suggestion_id: 's1', user_id: null });
      await flushBroadcasts();
      expect(mockDbPrepare).toHaveBeenCalledWith(
        'SELECT connection_id FROM websocket_connections WHERE sub_wish_id = ?'
      );
      expect(mockAll).toHaveBeenCalledWith('w-anon');

      emitAiSuggestionsReady({ wish_id: 'w-owned', suggestion_id: 's2', user_id: 'u-owner' });
      await flushBroadcasts();
      expect(mockDbPrepare).toHaveBeenCalledWith(
        'SELECT connection_id FROM websocket_connections WHERE sub_wish_id = ? OR user_id = ?'
      );
      expect(mockAll).toHaveBeenCalledWith('w-owned', 'u-owner');
      const sentPayload = JSON.parse(mockSend.mock.calls.at(-1)[0].Data);
      expect(sentPayload).toEqual({
        event: 'wish:ai_suggestions_ready',
        data: { wish_id: 'w-owned', suggestion_id: 's2' },
      });
    });
  });
});

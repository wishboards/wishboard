import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.WISHBOARD_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

vi.mock('@codegenie/serverless-express', () => {
  const mockInstance = vi.fn().mockResolvedValue('mocked-response');
  return { default: vi.fn(() => mockInstance) };
});

const mockDrainQueue = vi.fn().mockResolvedValue(undefined);
const mockFlushBroadcasts = vi.fn().mockResolvedValue([]);

vi.mock('../src/server/index.js', () => {
  return { default: 'mock-app' };
});

vi.mock('../src/server/ai/taggingWorker.js', () => ({
  drainQueue: mockDrainQueue,
}));

vi.mock('../src/server/socket.js', () => ({
  flushBroadcasts: mockFlushBroadcasts,
}));

describe('lambda.mjs', () => {
  beforeEach(() => {
    vi.resetModules();
    mockDrainQueue.mockClear();
    mockFlushBroadcasts.mockClear();
  });

  it('initializes serverlessExpress, drains AI queue and broadcasts, and caches the instance', async () => {
    const lambda = await import('./lambda.mjs');
    const serverlessExpress = (await import('@codegenie/serverless-express')).default;

    const event = { requestContext: {} };
    const context = {};
    const res1 = await lambda.handler(event, context);

    expect(serverlessExpress).toHaveBeenCalledWith({ app: 'mock-app' });
    expect(res1).toBe('mocked-response');
    expect(mockDrainQueue).toHaveBeenCalledTimes(1);
    expect(mockFlushBroadcasts).toHaveBeenCalledTimes(1);

    // Call again to test the cached branch
    const res2 = await lambda.handler(event, context);
    expect(res2).toBe('mocked-response');
    expect(serverlessExpress).toHaveBeenCalledTimes(1);
    expect(mockDrainQueue).toHaveBeenCalledTimes(2);
    expect(mockFlushBroadcasts).toHaveBeenCalledTimes(2);
  }, 15000);
});

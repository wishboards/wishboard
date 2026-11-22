import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.WISHBOARD_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

vi.mock('@codegenie/serverless-express', () => {
  const mockInstance = vi.fn().mockResolvedValue('mocked-response');
  return { default: vi.fn(() => mockInstance) };
});

const mockDrainQueue = vi.fn().mockResolvedValue(undefined);
const mockProcessWishJob = vi.fn().mockResolvedValue(undefined);
const mockFlushBroadcasts = vi.fn().mockResolvedValue([]);

vi.mock('../src/server/index.js', () => {
  return { default: 'mock-app' };
});

vi.mock('../src/server/ai/taggingWorker.js', () => ({
  ASYNC_TAGGING_EVENT_KEY: '__wishboardAsyncTask',
  drainQueue: mockDrainQueue,
  processWishJob: mockProcessWishJob,
}));

vi.mock('../src/server/socket.js', () => ({
  flushBroadcasts: mockFlushBroadcasts,
}));

describe('lambda.mjs', () => {
  beforeEach(() => {
    vi.resetModules();
    mockDrainQueue.mockClear();
    mockProcessWishJob.mockClear();
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

  it('handles async self-invoked AI tagging events outside the HTTP path', async () => {
    const lambda = await import('./lambda.mjs');
    const payload = { wishId: 'w-async-1', content: 'Queer switch seeking top' };
    const res = await lambda.handler({ __wishboardAsyncTask: 'aiTagging', payload }, {});

    expect(res).toEqual({ statusCode: 200, ok: true });
    expect(mockProcessWishJob).toHaveBeenCalledWith(payload);
    expect(mockDrainQueue).not.toHaveBeenCalled();
  });
});

/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

const logger = (await import('./logger.js')).default;
const { jsonErrorHandler } = await import('./errorHandler.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('jsonErrorHandler', () => {
  it('returns a retryable 503 JSON for SQLITE_BUSY (by error code)', () => {
    const res = mockRes();
    jsonErrorHandler(
      { code: 'SQLITE_BUSY', message: 'busy' },
      { path: '/api/wishes' },
      res,
      () => {}
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/busy/i) })
    );
  });

  it('detects a locked database by message text', () => {
    const res = mockRes();
    jsonErrorHandler({ message: 'database is locked' }, { path: '/x' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns a generic 500 JSON for other errors', () => {
    const res = mockRes();
    jsonErrorHandler(new Error('boom'), { path: '/x' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('honours an explicit err.status', () => {
    const res = mockRes();
    jsonErrorHandler({ message: 'bad request', status: 400 }, { path: '/x' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('exposes the message only when the error is marked safe (err.expose)', () => {
    const res = mockRes();
    jsonErrorHandler(
      { message: 'Invalid file type.', status: 400, expose: true },
      { path: '/x' },
      res,
      () => {}
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid file type.' });
  });

  it('does not leak the raw error message to the client', () => {
    const res = mockRes();
    jsonErrorHandler(new Error('secret internal detail'), { path: '/x' }, res, () => {});
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toMatch(/secret internal detail/);
  });

  it('returns the exact busy body and logs a warning with the request path', () => {
    const res = mockRes();
    jsonErrorHandler(
      { code: 'SQLITE_BUSY', message: 'busy' },
      { path: '/api/wishes' },
      res,
      () => {}
    );
    expect(res.json).toHaveBeenCalledWith({
      error: 'The wishboard is busy right now. Please wait a moment and try again.',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Database busy (write-lock contention); asked client to retry',
      { path: '/api/wishes' }
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('detects busy errors by SQLITE_BUSY in the message, case-insensitively', () => {
    for (const message of ['SQLITE_BUSY', 'sqlite_busy: retry', 'Database Is Locked']) {
      const res = mockRes();
      jsonErrorHandler({ message }, { path: '/x' }, res, () => {});
      expect(res.status).toHaveBeenCalledWith(503);
    }
  });

  it('returns the exact generic body for a 500 and logs it as an error', () => {
    const res = mockRes();
    jsonErrorHandler(new Error('boom'), { path: '/x' }, res, () => {});
    expect(res.json).toHaveBeenCalledWith({
      error: 'Something went wrong. Please try again.',
    });
    expect(logger.error).toHaveBeenCalledWith('Unhandled request error', {
      path: '/x',
      error: 'boom',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs sub-500 errors as warnings with status, and 500 itself as an error', () => {
    const res400 = mockRes();
    jsonErrorHandler({ message: 'bad request', status: 400 }, { path: '/x' }, res400, () => {});
    expect(logger.warn).toHaveBeenCalledWith('Request error', {
      path: '/x',
      status: 400,
      error: 'bad request',
    });
    expect(logger.error).not.toHaveBeenCalled();

    const res499 = mockRes();
    jsonErrorHandler({ message: 'almost', status: 499 }, { path: '/y' }, res499, () => {});
    expect(logger.warn).toHaveBeenCalledWith('Request error', {
      path: '/y',
      status: 499,
      error: 'almost',
    });

    const res500 = mockRes();
    jsonErrorHandler({ message: 'edge', status: 500 }, { path: '/z' }, res500, () => {});
    expect(logger.error).toHaveBeenCalledWith('Unhandled request error', {
      path: '/z',
      error: 'edge',
    });
  });

  it('treats a missing or non-numeric status as 500', () => {
    const res = mockRes();
    jsonErrorHandler({ message: 'no status' }, { path: '/x' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    const res2 = mockRes();
    jsonErrorHandler({ message: 'nan status', status: 'abc' }, { path: '/x' }, res2, () => {});
    expect(res2.status).toHaveBeenCalledWith(500);
  });

  it('falls back to the generic message when an exposed error has no message', () => {
    const res = mockRes();
    jsonErrorHandler({ status: 400, expose: true }, { path: '/x' }, res, () => {});
    expect(res.json).toHaveBeenCalledWith({
      error: 'Something went wrong. Please try again.',
    });
  });

  it('does not expose the message when expose is not strictly true', () => {
    const res = mockRes();
    jsonErrorHandler(
      { message: 'should stay hidden', status: 400, expose: 1 },
      { path: '/x' },
      res,
      () => {}
    );
    expect(res.json).toHaveBeenCalledWith({
      error: 'Something went wrong. Please try again.',
    });
  });

  it('handles a missing error object and a missing request without throwing', () => {
    const res = mockRes();
    expect(() => jsonErrorHandler(undefined, undefined, res, () => {})).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Something went wrong. Please try again.',
    });
    expect(logger.error).toHaveBeenCalledWith('Unhandled request error', {
      path: undefined,
      error: '',
    });

    const busyRes = mockRes();
    expect(() =>
      jsonErrorHandler({ code: 'SQLITE_BUSY', message: 'busy' }, undefined, busyRes, () => {})
    ).not.toThrow();
    expect(busyRes.status).toHaveBeenCalledWith(503);
    expect(logger.warn).toHaveBeenCalledWith(
      'Database busy (write-lock contention); asked client to retry',
      { path: undefined }
    );
  });
});

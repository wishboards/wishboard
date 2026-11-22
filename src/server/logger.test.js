import { describe, expect, it, vi, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import nodePath from 'node:path';

describe('Logger', () => {
  let tmpDir;

  afterEach(async () => {
    const winston = await import('winston');
    winston.default.loggers.close();
    vi.resetModules();
    vi.restoreAllMocks();
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Ignore EPERM during test cleanup on Windows where log file handle may close asynchronously
      }
      tmpDir = undefined;
    }
  });

  it('initializes logger with silent console in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const logger = (await import('./logger.js')).default;
    expect(logger).toBeDefined();
    expect(logger.transports.length).toBe(1); // Only Console
    expect(logger.transports[0].silent).toBe(true);
    expect(logger.level).toBe('debug');
    expect(globalThis.__wishboardLoggerLoaded).toBe(true);
  });

  it('stringifyIfNotEmpty returns empty string for empty meta and JSON otherwise', async () => {
    process.env.NODE_ENV = 'test';
    const { stringifyIfNotEmpty } = await import('./logger.js');
    expect(stringifyIfNotEmpty({})).toBe('');
    expect(stringifyIfNotEmpty({ a: 1 })).toBe('{"a":1}');
    expect(stringifyIfNotEmpty({ extraField: 'metaData' })).toBe('{"extraField":"metaData"}');
  });

  it('console printf format renders timestamp, level, message and meta exactly', async () => {
    process.env.NODE_ENV = 'test';
    const logger = (await import('./logger.js')).default;
    const consoleTransport = logger.transports[logger.transports.length - 1];
    const makeInfo = (extra) => {
      const info = {
        timestamp: '2026-01-01 01:02:03',
        level: 'info',
        message: 'hello',
        ...extra,
      };
      info[Symbol.for('level')] = 'info';
      return info;
    };
    const withMeta = consoleTransport.format.transform(makeInfo({ extraField: 'metaData' }), {});
    expect(withMeta[Symbol.for('message')]).toBe(
      '[2026-01-01 01:02:03] info: hello {"extraField":"metaData"}'
    );
    const bare = consoleTransport.format.transform(makeInfo({}), {});
    expect(bare[Symbol.for('message')]).toBe('[2026-01-01 01:02:03] info: hello ');
  });

  it('initializes logger with file transport and formatter in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Suppress actual stdout writes to prevent Vitest "Closing rpc while onUserConsoleLog was pending"
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Point the log file at a throwaway temp dir (reaped in afterEach) so the
    // test never writes log files into the repo working tree.
    tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'wishboard-logtest-'));
    const path = await import('node:path');
    vi.spyOn(path.default, 'join').mockReturnValue(nodePath.join(tmpDir, 'app.log'));

    const mockEmitSystemLog = vi.fn();
    vi.doMock('./socket.js', () => ({
      emitSystemLog: mockEmitSystemLog,
    }));

    const logger = (await import('./logger.js')).default;
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
    expect(globalThis.__wishboardLoggerLoaded).toBe(true);

    // production has DailyRotateFile, SocketTransport, and Console
    expect(logger.transports.length).toBe(3);

    const fileTransport = logger.transports.find((t) => t.constructor.name === 'DailyRotateFile');
    expect(fileTransport).toBeDefined();
    expect(fileTransport.options.datePattern).toBe('YYYY-MM-DD');
    expect(fileTransport.options.zippedArchive).toBe(false);
    expect(fileTransport.options.maxSize).toBe('20m');
    expect(fileTransport.options.maxFiles).toBe('14d');

    logger.info('test message', { extraField: 'metaData' });
    logger.info('test empty meta');

    // Wait a short moment for the async import & WebSocket emit log operation to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockEmitSystemLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] info: test message \{"extraField":"metaData"\}$/
      )
    );
    expect(mockEmitSystemLog).toHaveBeenCalledWith(
      expect.stringMatching(/info: test empty meta $/)
    );

    logger.close();
    stdoutSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  it('enables colorize in console transport under development TTY environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
    const originalIsTTY = process.stdout ? process.stdout.isTTY : undefined;

    process.env.NODE_ENV = 'development';
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (process.stdout) {
      process.stdout.isTTY = true;
    }

    const logger = (await import('./logger.js')).default;
    expect(logger).toBeDefined();

    process.env.NODE_ENV = originalEnv;
    if (originalLambda === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambda;
    }
    if (process.stdout) {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  // Runs the console transport's format chain over a synthetic log line and
  // reports whether winston's colorize step coloured the level.
  const transformLevel = (logger) => {
    const consoleTransport = logger.transports[logger.transports.length - 1];
    const info = { timestamp: '2026-01-01 01:02:03', level: 'info', message: 'hello' };
    info[Symbol.for('level')] = 'info';
    const out = consoleTransport.format.transform(info, {});
    return out.level;
  };

  it.each([
    // [NODE_ENV, lambda set, isTTY, expect colorized]
    ['development', false, true, true],
    ['production', false, true, false],
    ['development', true, true, false],
    ['development', false, false, false],
  ])(
    'colorize only for non-production, non-Lambda TTY consoles (env=%s lambda=%s tty=%s color=%s)',
    async (nodeEnv, lambdaSet, isTTY, expectColor) => {
      const originalEnv = process.env.NODE_ENV;
      const originalLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
      const originalDisable = process.env.DISABLE_FILE_LOGGING;
      const originalIsTTY = process.stdout ? process.stdout.isTTY : undefined;
      try {
        process.env.NODE_ENV = nodeEnv;
        // Keep the file transport out of these cases; it is covered separately.
        process.env.DISABLE_FILE_LOGGING = '1';
        if (lambdaSet) {
          process.env.AWS_LAMBDA_FUNCTION_NAME = 'wishboard-fn';
        } else {
          delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        }
        if (process.stdout) {
          process.stdout.isTTY = isTTY;
        }
        const logger = (await import('./logger.js')).default;
        const level = transformLevel(logger);
        if (expectColor) {
          expect(level).toContain('\u001b[32m');
        } else {
          expect(level).toBe('info');
        }
        expect(logger.level).toBe(nodeEnv === 'production' ? 'info' : 'debug');
        logger.close();
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalLambda === undefined) {
          delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        } else {
          process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambda;
        }
        if (originalDisable === undefined) {
          delete process.env.DISABLE_FILE_LOGGING;
        } else {
          process.env.DISABLE_FILE_LOGGING = originalDisable;
        }
        if (process.stdout) {
          process.stdout.isTTY = originalIsTTY;
        }
      }
    }
  );

  it.each([
    // [lambda set, disable set, expect file transport]
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ])(
    'file transport only when neither Lambda nor DISABLE_FILE_LOGGING (lambda=%s disable=%s file=%s)',
    async (lambdaSet, disableSet, expectFile) => {
      const originalEnv = process.env.NODE_ENV;
      const originalLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
      const originalDisable = process.env.DISABLE_FILE_LOGGING;
      try {
        process.env.NODE_ENV = 'development';
        if (lambdaSet) {
          process.env.AWS_LAMBDA_FUNCTION_NAME = 'wishboard-fn';
        } else {
          delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        }
        if (disableSet) {
          process.env.DISABLE_FILE_LOGGING = '1';
        } else {
          delete process.env.DISABLE_FILE_LOGGING;
        }
        if (expectFile) {
          // Point the log file at a throwaway temp dir, as the production test does.
          tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'wishboard-logtest-'));
          const path = await import('node:path');
          vi.spyOn(path.default, 'join').mockReturnValue(nodePath.join(tmpDir, 'app.log'));
        }
        const logger = (await import('./logger.js')).default;
        const hasFile = logger.transports.some((t) => t.constructor.name === 'DailyRotateFile');
        expect(hasFile).toBe(expectFile);
        expect(logger.transports.length).toBe(expectFile ? 3 : 2);
        logger.close();
        if (expectFile) {
          // Let the rotating file stream finish opening its file before
          // afterEach removes the temp dir it points at.
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalLambda === undefined) {
          delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        } else {
          process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambda;
        }
        if (originalDisable === undefined) {
          delete process.env.DISABLE_FILE_LOGGING;
        } else {
          process.env.DISABLE_FILE_LOGGING = originalDisable;
        }
      }
    }
  );

  it('SocketTransport formats meta, excludes timestamp/level/message keys, and calls back', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDisable = process.env.DISABLE_FILE_LOGGING;
    try {
      process.env.NODE_ENV = 'development';
      process.env.DISABLE_FILE_LOGGING = '1';
      const mockEmitSystemLog = vi.fn();
      vi.doMock('./socket.js', () => ({
        emitSystemLog: mockEmitSystemLog,
      }));
      const logger = (await import('./logger.js')).default;
      const socketTransport = logger.transports.find(
        (t) => t.constructor.name === 'SocketTransport'
      );
      expect(socketTransport).toBeDefined();
      // Outside the test environment the console transport must not be silent.
      expect(logger.transports[logger.transports.length - 1].silent).toBe(false);

      const callback = vi.fn();
      const info = {
        timestamp: '2026-01-01 01:02:03',
        level: 'info',
        message: 'direct',
        extraField: 'metaData',
        other: 42,
      };
      const logged = new Promise((resolve) => socketTransport.once('logged', resolve));
      socketTransport.log(info, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      await Promise.race([
        logged,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('logged event never emitted')), 1000)
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockEmitSystemLog).toHaveBeenCalledWith(
        '[2026-01-01 01:02:03] info: direct {"extraField":"metaData","other":42}'
      );

      const bareCallback = vi.fn();
      socketTransport.log(
        { timestamp: '2026-01-01 01:02:03', level: 'warn', message: 'bare' },
        bareCallback
      );
      expect(bareCallback).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockEmitSystemLog).toHaveBeenCalledWith('[2026-01-01 01:02:03] warn: bare ');
      logger.close();
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalDisable === undefined) {
        delete process.env.DISABLE_FILE_LOGGING;
      } else {
        process.env.DISABLE_FILE_LOGGING = originalDisable;
      }
    }
  });

  it('logger format preserves error stacks and timestamps log records', async () => {
    process.env.NODE_ENV = 'test';
    const logger = (await import('./logger.js')).default;
    const err = new Error('kaboom');
    err.level = 'error';
    err[Symbol.for('level')] = 'error';
    const out = logger.format.transform(err, {});
    expect(out.stack).toContain('Error: kaboom');
    expect(out.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(JSON.parse(out[Symbol.for('message')]).stack).toContain('Error: kaboom');
  });

  it('production file transport points at the rotating wishboard log file', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
    const originalDisable = process.env.DISABLE_FILE_LOGGING;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.DISABLE_FILE_LOGGING;
      // No path.join mock here on purpose: the filename itself is under test.
      // The transport writes into the app's gitignored runtime data dir.
      const logger = (await import('./logger.js')).default;
      const fileTransport = logger.transports.find((t) => t.constructor.name === 'DailyRotateFile');
      expect(fileTransport).toBeDefined();
      expect(fileTransport.options.filename).toMatch(/data[/\\]logs[/\\]wishboard-%DATE%\.log$/);
      logger.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLambda === undefined) {
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      } else {
        process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambda;
      }
      if (originalDisable === undefined) {
        delete process.env.DISABLE_FILE_LOGGING;
      } else {
        process.env.DISABLE_FILE_LOGGING = originalDisable;
      }
    }
  });

  it('SocketTransport reports a failed socket import to console.error', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDisable = process.env.DISABLE_FILE_LOGGING;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.env.NODE_ENV = 'development';
      process.env.DISABLE_FILE_LOGGING = '1';
      vi.doMock('./socket.js', () => {
        throw new Error('socket boom');
      });
      const logger = (await import('./logger.js')).default;
      const socketTransport = logger.transports.find(
        (t) => t.constructor.name === 'SocketTransport'
      );
      expect(socketTransport).toBeDefined();
      socketTransport.log(
        { timestamp: '2026-01-01 01:02:03', level: 'info', message: 'direct' },
        vi.fn()
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(errorSpy).toHaveBeenCalledWith('SOCKET TRANSPORT IMPORT ERROR:', expect.any(Error));
      logger.close();
    } finally {
      errorSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
      if (originalDisable === undefined) {
        delete process.env.DISABLE_FILE_LOGGING;
      } else {
        process.env.DISABLE_FILE_LOGGING = originalDisable;
      }
    }
  });
});

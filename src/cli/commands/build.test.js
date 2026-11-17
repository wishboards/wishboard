/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import https from 'https';
import { EventEmitter } from 'events';

// Mock fs and https before importing the module
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    default: {
      ...original,
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(),
      existsSync: vi.fn(),
      statSync: vi.fn().mockReturnValue({ size: 1024 }),
      unlink: vi.fn((p, cb) => cb && cb()),
    },
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ size: 1024 }),
    unlink: vi.fn((p, cb) => cb && cb()),
  };
});

vi.mock('https', () => {
  return {
    default: {
      get: vi.fn(),
    },
    get: vi.fn(),
  };
});

import { downloadFile, downloadFonts, FONTS, targetDir } from './build.js';

describe('download-fonts', () => {
  let mockWriteStream;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWriteStream = new EventEmitter();
    mockWriteStream.close = vi.fn((cb) => cb && cb());
    fs.createWriteStream.mockReturnValue(mockWriteStream);
  });

  describe('downloadFile', () => {
    it('successfully downloads a file', async () => {
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      mockResponse.pipe = vi.fn();

      https.get.mockImplementation((url, cb) => {
        cb(mockResponse);
        // Simulate response finish
        setTimeout(() => {
          mockWriteStream.emit('finish');
        }, 10);
        return new EventEmitter();
      });

      const promise = downloadFile('https://example.com/font.ttf', 'test.ttf');
      await expect(promise).resolves.toBeUndefined();
      expect(https.get).toHaveBeenCalledWith('https://example.com/font.ttf', expect.any(Function));
    });

    it('rejects on non-200 status code', async () => {
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 404;

      https.get.mockImplementation((url, cb) => {
        cb(mockResponse);
        return new EventEmitter();
      });

      const promise = downloadFile('https://example.com/font.ttf', 'test.ttf');
      await expect(promise).rejects.toThrow('Failed to download: Status 404');
    });

    it('rejects on network error', async () => {
      const mockRequest = new EventEmitter();
      https.get.mockReturnValue(mockRequest);

      const promise = downloadFile('https://example.com/font.ttf', 'test.ttf');

      // Simulate request error
      mockRequest.emit('error', new Error('Network Error'));

      await expect(promise).rejects.toThrow('Network Error');
      expect(fs.unlink).toHaveBeenCalledWith('test.ttf', expect.any(Function));
    });

    it('follows redirects', async () => {
      const redirectResponse = new EventEmitter();
      redirectResponse.statusCode = 302;
      redirectResponse.headers = { location: 'https://example.com/font-redirected.ttf' };

      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      mockResponse.pipe = vi.fn();

      https.get.mockImplementation((url, cb) => {
        if (url === 'https://example.com/font.ttf') {
          cb(redirectResponse);
        } else {
          cb(mockResponse);
          setTimeout(() => {
            mockWriteStream.emit('finish');
          }, 10);
        }
        return new EventEmitter();
      });

      const promise = downloadFile('https://example.com/font.ttf', 'test.ttf');
      await expect(promise).resolves.toBeUndefined();
      expect(https.get).toHaveBeenCalledTimes(2);
      expect(fs.unlink).toHaveBeenCalledWith('test.ttf', expect.any(Function));
    });

    it('rejects on too many redirects', async () => {
      const redirectResponse = new EventEmitter();
      redirectResponse.statusCode = 302;
      redirectResponse.headers = { location: 'https://example.com/font.ttf' };

      https.get.mockImplementation((url, cb) => {
        cb(redirectResponse);
        return new EventEmitter();
      });

      const promise = downloadFile('https://example.com/font.ttf', 'test.ttf');
      await expect(promise).rejects.toThrow('Too many redirects');
    });
  });

  describe('main', () => {
    it('downloads all fonts when offline fallback is not needed', async () => {
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      mockResponse.pipe = vi.fn();

      https.get.mockImplementation((url, cb) => {
        cb(mockResponse);
        setTimeout(() => {
          mockWriteStream.emit('finish');
        }, 5);
        return new EventEmitter();
      });

      await downloadFonts();

      expect(fs.mkdirSync).toHaveBeenCalledWith(targetDir, { recursive: true });
      expect(https.get).toHaveBeenCalledTimes(FONTS.length);
    });

    it('returns early when dryRun is true', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await downloadFonts({ dryRun: true });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Would have downloaded fallback fonts to: ' + targetDir
      );
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(https.get).not.toHaveBeenCalled();
    });

    it('logs warning and uses cached files when download fails but they exist', async () => {
      // Simulate download failure
      https.get.mockImplementation((_url, _cb) => {
        const req = new EventEmitter();
        setTimeout(() => {
          req.emit('error', new Error('Connection failed'));
        }, 5);
        return req;
      });

      // Pretend cache exists
      fs.existsSync.mockReturnValue(true);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await downloadFonts();

      expect(consoleWarnSpy).toHaveBeenCalledTimes(FONTS.length);
      expect(consoleLogSpy).toHaveBeenCalledWith('Checking for font updates...');
      expect(consoleLogSpy).toHaveBeenCalledWith('Using cached version of NotoColorEmoji.ttf');
    });

    it('exits with code 1 when download fails and cache does not exist', async () => {
      // Simulate download failure
      https.get.mockImplementation((_url, _cb) => {
        const req = new EventEmitter();
        setTimeout(() => {
          req.emit('error', new Error('Connection failed'));
        }, 5);
        return req;
      });

      // Pretend cache does not exist
      fs.existsSync.mockReturnValue(false);

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await downloadFonts();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});

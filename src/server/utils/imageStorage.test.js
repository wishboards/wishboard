import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  fileFilter,
  ALLOWED_RASTER_EXTENSIONS,
  createUploadMiddleware,
  processUploadedImage,
  uploadImageToS3,
} from './imageStorage.js';

describe('imageStorage utility', () => {
  describe('ALLOWED_RASTER_EXTENSIONS', () => {
    it('only contains safe raster formats', () => {
      expect(ALLOWED_RASTER_EXTENSIONS).toEqual(['.png', '.jpg', '.jpeg', '.webp']);
      expect(ALLOWED_RASTER_EXTENSIONS).not.toContain('.svg');
      expect(ALLOWED_RASTER_EXTENSIONS).not.toContain('.html');
    });
  });

  describe('fileFilter', () => {
    it('accepts valid raster image extensions', () => {
      const validFiles = ['test.png', 'photo.jpg', 'image.jpeg', 'graphic.webp', 'UPPER.PNG'];
      for (const name of validFiles) {
        const cb = vi.fn();
        fileFilter({}, { originalname: name }, cb);
        expect(cb).toHaveBeenCalledWith(null, true);
      }
    });

    it('rejects SVG and dangerous extensions with a 400 status error', () => {
      const invalidFiles = ['logo.svg', 'script.js', 'page.html', 'payload.php', 'data.json'];
      for (const name of invalidFiles) {
        const cb = vi.fn();
        fileFilter({}, { originalname: name }, cb);
        expect(cb).toHaveBeenCalledTimes(1);
        const [err, accepted] = cb.mock.calls[0];
        expect(accepted).toBe(false);
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(400);
        expect(err.expose).toBe(true);
        expect(err.message).toContain('Only PNG, JPG, and WEBP are allowed');
      }
    });
  });

  describe('createUploadMiddleware', () => {
    it('creates a multer upload middleware with specified prefix', () => {
      const upload = createUploadMiddleware('custom-prefix', 1024 * 1024);
      expect(upload).toBeDefined();
      expect(typeof upload.single).toBe('function');
    });
  });

  describe('processUploadedImage & uploadImageToS3', () => {
    const originalEnv = process.env.AWS_S3_BUCKET;

    afterEach(() => {
      process.env.AWS_S3_BUCKET = originalEnv;
    });

    it('returns local url when not in S3 mode', async () => {
      delete process.env.AWS_S3_BUCKET;
      const file = { filename: 'branding-123.webp' };
      const res = await processUploadedImage(file);
      expect(res.error).toBeNull();
      expect(res.url).toBe('/images/branding-123.webp');
      expect(res.filename).toBe('branding-123.webp');
    });
  });
});

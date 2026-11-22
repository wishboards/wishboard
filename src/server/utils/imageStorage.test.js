import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fileFilter,
  ALLOWED_RASTER_EXTENSIONS,
  MAX_IMAGE_SIZE_BYTES,
  createUploadMiddleware,
  processUploadedImage,
  imagesDir,
  isS3Mode,
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
        expect(err.message).toBe('Invalid file type. Only PNG, JPG, and WEBP are allowed.');
      }
    });

    it('rejects files with no extension', () => {
      const cb = vi.fn();
      fileFilter({}, { originalname: 'noextension' }, cb);
      const [err, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(err.status).toBe(400);
    });
  });

  describe('constants and local mode', () => {
    it('caps images at exactly 5 MB', () => {
      expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
      expect(MAX_IMAGE_SIZE_BYTES).toBe(5242880);
    });

    it('is in local mode without AWS_S3_BUCKET, storing under data/images', () => {
      expect(isS3Mode).toBe(false);
      expect(imagesDir).toMatch(/data[/\\]images$/);
    });
  });

  describe('createUploadMiddleware', () => {
    it('creates a multer upload middleware with specified prefix', () => {
      const upload = createUploadMiddleware('custom-prefix', 1024 * 1024);
      expect(upload).toBeDefined();
      expect(typeof upload.single).toBe('function');
    });

    it('applies the requested size limit, defaulting to MAX_IMAGE_SIZE_BYTES', () => {
      expect(createUploadMiddleware('p', 12345).limits.fileSize).toBe(12345);
      expect(createUploadMiddleware().limits.fileSize).toBe(MAX_IMAGE_SIZE_BYTES);
      expect(createUploadMiddleware().fileFilter).toBe(fileFilter);
    });

    it('stores files in imagesDir', async () => {
      const upload = createUploadMiddleware();
      const dest = await new Promise((resolve, reject) =>
        upload.storage.getDestination({}, {}, (err, d) => (err ? reject(err) : resolve(d)))
      );
      expect(dest).toBe(imagesDir);
    });

    it('generates prefixed filenames with a lowercased extension', async () => {
      const upload = createUploadMiddleware('custom-prefix');
      const name = await new Promise((resolve, reject) =>
        upload.storage.getFilename({}, { originalname: 'Photo.JPG' }, (err, n) =>
          err ? reject(err) : resolve(n)
        )
      );
      expect(name).toMatch(/^custom-prefix-\d+-\d+\.jpg$/);
    });

    it('defaults the generated filename extension to .png when the upload has none', async () => {
      const upload = createUploadMiddleware();
      const name = await new Promise((resolve, reject) =>
        upload.storage.getFilename({}, { originalname: 'noextension' }, (err, n) =>
          err ? reject(err) : resolve(n)
        )
      );
      expect(name).toMatch(/^image-\d+-\d+\.png$/);
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

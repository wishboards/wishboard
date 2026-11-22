/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Controllable stand-ins for the AWS SDK, wired in before the module under
// test is imported (S3 mode is decided from the environment at import time).
const s3 = vi.hoisted(() => ({ send: vi.fn(), commands: [] }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3.send;
  },
  PutObjectCommand: class {
    constructor(input) {
      this.input = input;
      s3.commands.push(this);
    }
  },
}));

process.env.AWS_S3_BUCKET = 'test-bucket';
const { uploadImageToS3, processUploadedImage, isS3Mode, imagesDir } =
  await import('./imageStorage.js');

// The real SDK consumes the request body stream; the mock must do the same,
// otherwise the module's post-upload unlink races the stream's lazy open.
const drainBody = async (command) => {
  for await (const chunk of command.input.Body) {
    void chunk;
  }
};
const sendOk = async (command) => {
  await drainBody(command);
  return {};
};
const sendFail = async (command) => {
  await drainBody(command);
  throw new Error('s3 down');
};

describe('imageStorage S3 mode', () => {
  const filename = `stryker-s3-test-${process.pid}.png`;
  const filePath = path.join(imagesDir, filename);

  beforeEach(() => {
    s3.send.mockReset();
    s3.commands.length = 0;
    fs.writeFileSync(filePath, 'fake image bytes');
  });

  afterEach(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  it('is in S3 mode with the temp dir as its staging area', () => {
    expect(isS3Mode).toBe(true);
    expect(imagesDir).toBe('/tmp');
  });

  it('uploads the file to the configured bucket and removes the local copy', async () => {
    s3.send.mockImplementation(sendOk);
    const result = await uploadImageToS3({ filename, mimetype: 'image/png' });
    expect(result).toEqual({ error: null, url: `/images/${filename}` });
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(s3.commands).toHaveLength(1);
    expect(s3.commands[0].input.Bucket).toBe('test-bucket');
    expect(s3.commands[0].input.Key).toBe(`images/${filename}`);
    expect(s3.commands[0].input.ContentType).toBe('image/png');
    expect(s3.commands[0].input.Body).toBeDefined();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('reports a generic error and still removes the local copy when S3 fails', async () => {
    s3.send.mockImplementation(sendFail);
    const result = await uploadImageToS3({ filename, mimetype: 'image/png' });
    expect(result).toEqual({ error: 'Failed to process image upload.', url: null });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('processUploadedImage delegates to S3 and keeps the filename', async () => {
    s3.send.mockImplementation(sendOk);
    const result = await processUploadedImage({ filename, mimetype: 'image/png' });
    expect(result).toEqual({ error: null, url: `/images/${filename}`, filename });
  });

  it('processUploadedImage propagates an S3 failure with the filename', async () => {
    s3.send.mockImplementation(sendFail);
    const result = await processUploadedImage({ filename, mimetype: 'image/png' });
    expect(result).toEqual({
      error: 'Failed to process image upload.',
      url: null,
      filename,
    });
  });
});

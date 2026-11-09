import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isS3Mode = Boolean(process.env.AWS_S3_BUCKET);
export const imagesDir = isS3Mode ? '/tmp' : path.resolve(__dirname, '../../../data/images');

if (!isS3Mode) {
  try {
    fs.mkdirSync(imagesDir, { recursive: true });
  } catch (err) {
    logger.warn('Could not create images directory:', err.message);
  }
}

export const ALLOWED_RASTER_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp']);
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_RASTER_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    const err = new Error('Invalid file type. Only PNG, JPG, and WEBP are allowed.');
    err.status = 400;
    err.expose = true;
    cb(err, false);
  }
};

export const createUploadMiddleware = (
  fieldPrefix = 'image',
  maxSizeBytes = MAX_IMAGE_SIZE_BYTES
) => {
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, imagesDir);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      const uniqueSuffix = Date.now() + '-' + crypto.randomInt(0, 1000000000);
      cb(null, `${fieldPrefix}-${uniqueSuffix}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: maxSizeBytes },
  });
};

export const uploadImageToS3 = async (file) => {
  const safePath = path.join(imagesDir, path.basename(file.filename));
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client();
    const fileStream = fs.createReadStream(safePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `images/${file.filename}`,
        Body: fileStream,
        ContentType: file.mimetype,
      })
    );

    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }

    logger.info('Uploaded image to S3', {
      bucket: process.env.AWS_S3_BUCKET,
      key: `images/${file.filename}`,
    });
    return { error: null, url: `/images/${file.filename}` };
  } catch (err) {
    logger.error('Failed to upload image to S3:', { error: err.message });
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
    return { error: 'Failed to process image upload.', url: null };
  }
};

/**
 * Process a freshly uploaded multer file, transferring it to S3 if in serverless
 * mode or retaining it in the local images directory.
 *
 * @param {Express.Multer.File} file
 * @returns {Promise<{ error: string|null, url: string|null, filename: string }>}
 */
export const processUploadedImage = async (file) => {
  if (isS3Mode) {
    const result = await uploadImageToS3(file);
    return { error: result.error, url: result.url, filename: file.filename };
  }
  return { error: null, url: `/images/${file.filename}`, filename: file.filename };
};

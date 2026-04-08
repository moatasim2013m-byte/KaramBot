const { Storage } = require('@google-cloud/storage');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_GCS_BUCKET_NAME = '';
const GCS_BUCKET_NAME = (process.env.GCS_BUCKET_NAME || DEFAULT_GCS_BUCKET_NAME).trim();

const UPLOAD_STORAGE_MODE = (process.env.UPLOAD_STORAGE_MODE || 'auto').toLowerCase();
const LOCAL_UPLOADS_DIR = path.resolve(
  process.env.LOCAL_UPLOADS_DIR || path.join(__dirname, '..', 'uploads')
);

const storageClient = new Storage();
const gcsBucket = GCS_BUCKET_NAME ? storageClient.bucket(GCS_BUCKET_NAME) : null;

const isGcsBucketConfigured = Boolean(GCS_BUCKET_NAME);

const buildPublicGcsUrl = (objectPath) => `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${objectPath}`;

const normalizeObjectPath = (objectPath) => {
  const normalized = String(objectPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|$)/g, '')
    .trim();

  if (!normalized) {
    throw new Error('Invalid object path');
  }

  return normalized;
};

const buildLocalUploadUrl = (objectPath) => `/uploads/${encodeURI(objectPath)}`;

const uploadBufferToLocal = async ({ objectPath, buffer }) => {
  const safeObjectPath = normalizeObjectPath(objectPath);
  const targetPath = path.join(LOCAL_UPLOADS_DIR, safeObjectPath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);

  return buildLocalUploadUrl(safeObjectPath);
};

const uploadBufferToGcsOnly = async ({
  objectPath,
  buffer,
  contentType,
  cacheControl = 'public, max-age=31536000'
}) => {
  if (!GCS_BUCKET_NAME || !gcsBucket) {
    throw new Error('GCS bucket is not configured');
  }

  const safeObjectPath = normalizeObjectPath(objectPath);

  await gcsBucket.file(safeObjectPath).save(buffer, {
    contentType,
    metadata: { cacheControl }
  });

  return buildPublicGcsUrl(safeObjectPath);
};

const uploadBufferToGcs = async (args) => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (UPLOAD_STORAGE_MODE === 'local') {
    return uploadBufferToLocal(args);
  }

  // In production, local storage is not durable across restarts/instances.
  // Never fall back to local unless storage mode is explicitly forced to `local`.
  if (!isGcsBucketConfigured && isProduction) {
    throw new Error('Durable upload storage is not configured (missing GCS_BUCKET_NAME)');
  }

  if (isProduction) {
    return uploadBufferToGcsOnly(args);
  }

  try {
    return await uploadBufferToGcsOnly(args);
  } catch (error) {
    if (UPLOAD_STORAGE_MODE === 'gcs') {
      throw error;
    }

    console.warn('GCS upload failed, falling back to local storage:', error?.message || error);
    return uploadBufferToLocal(args);
  }
};

module.exports = {
  DEFAULT_GCS_BUCKET_NAME,
  GCS_BUCKET_NAME,
  LOCAL_UPLOADS_DIR,
  UPLOAD_STORAGE_MODE,
  gcsBucket,
  isGcsBucketConfigured,
  buildPublicGcsUrl,
  buildLocalUploadUrl,
  uploadBufferToGcs
};

const { Storage } = require('@google-cloud/storage');

const DEFAULT_GCS_BUCKET_NAME = 'peekaboo-uploads';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || DEFAULT_GCS_BUCKET_NAME;

const storageClient = new Storage();
const gcsBucket = storageClient.bucket(GCS_BUCKET_NAME);

const isGcsBucketConfigured = Boolean(process.env.GCS_BUCKET_NAME);

const buildPublicGcsUrl = (objectPath) => `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${objectPath}`;

const uploadBufferToGcs = async ({
  objectPath,
  buffer,
  contentType,
  cacheControl = 'public, max-age=31536000'
}) => {
  await gcsBucket.file(objectPath).save(buffer, {
    contentType,
    metadata: { cacheControl }
  });

  return buildPublicGcsUrl(objectPath);
};

module.exports = {
  DEFAULT_GCS_BUCKET_NAME,
  GCS_BUCKET_NAME,
  gcsBucket,
  isGcsBucketConfigured,
  buildPublicGcsUrl,
  uploadBufferToGcs
};

/**
 * WhatsApp Media Utilities
 * Fetches temporary download URLs for media stored as Meta media IDs
 */

const FormData = require('form-data');
const { fetchMetaWithRetry } = require('./metaApiClient');

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];

/**
 * Given a Meta media ID, returns a temporary HTTPS download URL.
 * The URL expires after ~5 minutes per Meta docs.
 */
async function getMetaMediaUrl(mediaId) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!accessToken || !mediaId) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    return data.url || null;
  } catch {
    return null;
  }
}

/**
 * Given a temporary Meta media URL, streams the binary content.
 * Returns { ok, buffer, contentType } or { ok: false }
 */
async function downloadMetaMedia(mediaUrl) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!accessToken || !mediaUrl) return { ok: false };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) return { ok: false };

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return { ok: true, buffer, contentType };
  } catch {
    return { ok: false };
  }
}

/**
 * Upload a media buffer to Meta's media endpoint.
 * Returns { ok: true, mediaId } or { ok: false, error }
 */
async function uploadMediaToMeta(buffer, mimeType, filename) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return { ok: false, error: 'Missing credentials' };

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return {
      ok: false,
      error: `Unsupported MIME type "${mimeType}". Only image/jpeg and image/png are allowed by Staff Inbox.`
    };
  }

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', buffer, { filename: filename || 'image.jpg', contentType: mimeType });

    const result = await fetchMetaWithRetry(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...form.getHeaders()
        },
        body: form
      },
      { event: 'meta_media_upload', mimeType, phoneNumberId }
    );

    if (!result.ok) {
      return { ok: false, error: result.error || result.text?.slice(0, 500) || 'Meta upload failed' };
    }

    const data = JSON.parse(result.text || '{}');
    return { ok: true, mediaId: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { getMetaMediaUrl, downloadMetaMedia, uploadMediaToMeta, ALLOWED_IMAGE_MIME_TYPES };

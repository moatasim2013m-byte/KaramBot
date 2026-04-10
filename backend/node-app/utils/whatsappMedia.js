/**
 * WhatsApp Media Utilities
 * Fetches temporary download URLs for media stored as Meta media IDs
 */

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/3gpp', 'video/quicktime'];

const META_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetry = (status) => status === 429 || (status >= 500 && status <= 599);

async function metaFetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), META_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok || !shouldRetry(response.status) || attempt === MAX_RETRIES) {
        return response;
      }

      const backoffMs = Math.min(4000, 300 * (2 ** attempt));
      await sleep(backoffMs);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === MAX_RETRIES) throw error;
      const backoffMs = Math.min(4000, 300 * (2 ** attempt));
      await sleep(backoffMs);
    }
  }

  throw lastError || new Error('Meta request failed');
}

/**
 * Given a Meta media ID, returns a temporary HTTPS download URL.
 * The URL expires after ~5 minutes per Meta docs.
 */
async function getMetaMediaUrl(mediaId) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!accessToken || !mediaId) return null;

  try {
    const response = await metaFetchWithRetry(`https://graph.facebook.com/v23.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

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
    const response = await metaFetchWithRetry(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

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
async function uploadMediaToMeta(buffer, mimeType, filename, options = {}) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return { ok: false, error: 'Missing credentials' };
  const allowedMimeTypes = options.allowedMimeTypes || ALLOWED_IMAGE_MIME_TYPES;
  const defaultFilename = options.defaultFilename || (mimeType === 'image/png' ? 'image.png' : 'image.jpg');

  if (!allowedMimeTypes.includes(mimeType)) {
    return {
      ok: false,
      error: `Unsupported MIME type "${mimeType}". Allowed: ${allowedMimeTypes.join(', ')}.`
    };
  }

  try {
    const form = new FormData();

    // Meta requires these three fields exactly as documented:
    // POST /PHONE_NUMBER_ID/media with messaging_product, type, and file
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    const finalFilename = filename || defaultFilename;
    const fileBlob = new Blob([buffer], { type: mimeType });
    form.append('file', fileBlob, finalFilename);
    const uploadUrl = `https://graph.facebook.com/v23.0/${phoneNumberId}/media`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: form,
      signal: controller.signal
    });
    clearTimeout(timeout);
    const responseText = await response.text();

    console.log('META_UPLOAD_RESPONSE', {
      status: response.status,
      body: responseText.slice(0, 300)
    });

    if (!response.ok) {
      return { ok: false, error: responseText.slice(0, 200), status: response.status };
    }

    const data = JSON.parse(responseText);
    if (!data.id) return { ok: false, error: 'Meta returned no media ID', raw: responseText.slice(0, 200) };
    return { ok: true, mediaId: data.id };
  } catch (err) {
    console.error('META_UPLOAD_EXCEPTION', err.message);
    return { ok: false, error: err.message, statusCode: 500 };
  }
}

async function sendMetaImageMessage({ to, mediaId, caption }) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return { ok: false, error: 'Missing credentials' };

  try {
    const response = await metaFetchWithRetry(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: { id: mediaId, caption: caption || '' }
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { ok: false, error: responseText.slice(0, 500), status: response.status };
    }

    const data = JSON.parse(responseText);
    return {
      ok: true,
      messageId: data?.messages?.[0]?.id || null
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function sendMetaVideoMessage({ to, mediaId, caption }) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return { ok: false, error: 'Missing credentials' };

  try {
    const response = await metaFetchWithRetry(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'video',
        video: { id: mediaId, caption: caption || '' }
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { ok: false, error: responseText.slice(0, 500), status: response.status };
    }

    const data = JSON.parse(responseText);
    return {
      ok: true,
      messageId: data?.messages?.[0]?.id || null
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  getMetaMediaUrl,
  downloadMetaMedia,
  uploadMediaToMeta,
  sendMetaImageMessage,
  sendMetaVideoMessage,
  metaFetchWithRetry,
  ALLOWED_VIDEO_MIME_TYPES
};

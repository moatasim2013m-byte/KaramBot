/**
 * WhatsApp Media Utilities
 * Fetches temporary download URLs for media stored as Meta media IDs
 */

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

module.exports = { getMetaMediaUrl, downloadMetaMedia };

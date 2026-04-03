const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const META_GRAPH_API_VERSION = 'v22.0';

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

const resolveAccessToken = () => {
  const explicit = getTrimmedEnv('META_ACCESS_TOKEN');
  if (explicit) return explicit;
  return getTrimmedEnv('WHATSAPP_ACCESS_TOKEN');
};

const resolveInstagramBusinessAccountId = (input) => {
  const value = String(input || '').trim();
  if (value) return value;
  return getTrimmedEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
};

const parseGraphError = async (response) => {
  const responseText = await response.text();
  try {
    const payload = JSON.parse(responseText);
    return payload?.error?.message || responseText || 'Unknown Meta API error';
  } catch (_) {
    return responseText || 'Unknown Meta API error';
  }
};

const validateIceBreakers = (iceBreakers) => {
  if (!Array.isArray(iceBreakers)) {
    return 'ice_breakers must be an array';
  }

  if (iceBreakers.length > 4) {
    return 'ice_breakers supports up to 4 questions';
  }

  for (const breaker of iceBreakers) {
    const question = String(breaker?.question || '').trim();
    if (!question) {
      return 'each ice breaker must include a non-empty question';
    }

    if (question.length > 80) {
      return 'each question must be at most 80 characters';
    }
  }

  return null;
};

const normalizeIceBreakersPayload = (iceBreakers) => {
  return iceBreakers.map((breaker) => {
    const question = String(breaker?.question || '').trim();
    const payload = String(breaker?.payload || question).trim();
    return { question, payload };
  });
};

const buildMetaHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
});

router.get('/ice-breakers', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = resolveAccessToken();
    const instagramBusinessAccountId = resolveInstagramBusinessAccountId(
      req.query.instagram_business_account_id
    );

    if (!accessToken) {
      return res.status(500).json({
        error: 'META_ACCESS_TOKEN (or WHATSAPP_ACCESS_TOKEN fallback) must be configured'
      });
    }

    if (!instagramBusinessAccountId) {
      return res.status(400).json({
        error:
          'instagram_business_account_id is required (or set INSTAGRAM_BUSINESS_ACCOUNT_ID)'
      });
    }

    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      instagramBusinessAccountId
    )}?fields=ice_breakers`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: buildMetaHeaders(accessToken)
    });

    if (!response.ok) {
      const details = await parseGraphError(response);
      return res.status(502).json({
        error: 'Failed to fetch Instagram ice breakers from Meta',
        details
      });
    }

    const payload = await response.json();
    return res.json({
      success: true,
      instagram_business_account_id: instagramBusinessAccountId,
      ice_breakers: Array.isArray(payload?.ice_breakers) ? payload.ice_breakers : []
    });
  } catch (error) {
    console.error('INSTAGRAM_ICE_BREAKERS_GET_FAILED', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch Instagram ice breakers' });
  }
});

router.post('/ice-breakers', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = resolveAccessToken();
    const instagramBusinessAccountId = resolveInstagramBusinessAccountId(
      req.body?.instagram_business_account_id || req.query.instagram_business_account_id
    );

    if (!accessToken) {
      return res.status(500).json({
        error: 'META_ACCESS_TOKEN (or WHATSAPP_ACCESS_TOKEN fallback) must be configured'
      });
    }

    if (!instagramBusinessAccountId) {
      return res.status(400).json({
        error:
          'instagram_business_account_id is required (or set INSTAGRAM_BUSINESS_ACCOUNT_ID)'
      });
    }

    const validationError = validateIceBreakers(req.body?.ice_breakers);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      instagramBusinessAccountId
    )}/messenger_profile`;

    const metaRequestBody = {
      platform: 'instagram',
      ice_breakers: normalizeIceBreakersPayload(req.body.ice_breakers)
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildMetaHeaders(accessToken),
      body: JSON.stringify(metaRequestBody)
    });

    if (!response.ok) {
      const details = await parseGraphError(response);
      return res.status(502).json({
        error: 'Meta rejected Instagram ice breakers update',
        details
      });
    }

    const payload = await response.json();
    return res.json({
      success: Boolean(payload?.result === 'success' || payload?.success),
      instagram_business_account_id: instagramBusinessAccountId,
      submitted_ice_breakers: metaRequestBody.ice_breakers,
      meta: payload
    });
  } catch (error) {
    console.error('INSTAGRAM_ICE_BREAKERS_POST_FAILED', { error: error.message });
    return res.status(500).json({ error: 'Failed to update Instagram ice breakers' });
  }
});

router.delete('/ice-breakers', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = resolveAccessToken();
    const instagramBusinessAccountId = resolveInstagramBusinessAccountId(
      req.body?.instagram_business_account_id || req.query.instagram_business_account_id
    );

    if (!accessToken) {
      return res.status(500).json({
        error: 'META_ACCESS_TOKEN (or WHATSAPP_ACCESS_TOKEN fallback) must be configured'
      });
    }

    if (!instagramBusinessAccountId) {
      return res.status(400).json({
        error:
          'instagram_business_account_id is required (or set INSTAGRAM_BUSINESS_ACCOUNT_ID)'
      });
    }

    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      instagramBusinessAccountId
    )}/messenger_profile`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: buildMetaHeaders(accessToken),
      body: JSON.stringify({ fields: ['ice_breakers'], platform: 'instagram' })
    });

    if (!response.ok) {
      const details = await parseGraphError(response);
      return res.status(502).json({
        error: 'Meta rejected Instagram ice breakers delete',
        details
      });
    }

    const payload = await response.json();
    return res.json({
      success: Boolean(payload?.result === 'success' || payload?.success),
      instagram_business_account_id: instagramBusinessAccountId,
      meta: payload
    });
  } catch (error) {
    console.error('INSTAGRAM_ICE_BREAKERS_DELETE_FAILED', { error: error.message });
    return res.status(500).json({ error: 'Failed to delete Instagram ice breakers' });
  }
});

module.exports = router;

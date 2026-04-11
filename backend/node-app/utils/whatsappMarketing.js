/**
 * WhatsApp Marketing Messages Utility
 *
 * Uses the Meta /marketing_messages endpoint (GA Feb 2026) for all proactive
 * marketing and broadcast traffic that falls outside the 24-hour customer-service
 * window or requires pre-approved templates.
 *
 * Endpoint: POST https://graph.facebook.com/v25.0/{phone_number_id}/marketing_messages
 */

const { fetchMetaWithRetry } = require('./metaApiClient');
const { logger } = require('./logger');
const { isWhatsAppOptedOut } = require('./whatsappOptOut');

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

/**
 * Send a pre-approved WhatsApp template message via the Marketing Messages API.
 *
 * @param {Object} params
 * @param {string} params.to           - Recipient phone in E.164 digits (no "+"), e.g. "962796381676"
 * @param {string} params.templateName - Approved Meta template name
 * @param {string} [params.languageCode] - Template language code, defaults to "ar"
 * @param {Array}  [params.components] - Template component objects for variable injection
 *                                        e.g. [{ type: "body", parameters: [{ type: "text", text: "John" }] }]
 * @param {*}      [params.staffId]    - ObjectId of staff member triggering the send (for audit)
 * @param {*}      [params.campaignId] - ObjectId of parent campaign (for audit/stats)
 * @param {number} [params.ttl_seconds] - Time-to-live in seconds (720*3600 to 30*24*3600, i.e. 12h–30d)
 * @returns {Promise<{ok: boolean, messageId?: string, reason?: string, error?: string, status?: number, responseText?: string}>}
 */
const postWhatsAppTemplate = async ({ to, templateName, languageCode, components, staffId, campaignId, ttl_seconds }) => {
  const accessToken = getTrimmedEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = getTrimmedEnv('WHATSAPP_PHONE_NUMBER_ID');

  if (!accessToken || !phoneNumberId) {
    console.warn('WHATSAPP_MARKETING_CONFIG_MISSING: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
    return { ok: false, reason: 'missing_config' };
  }

  const optOutStatus = await isWhatsAppOptedOut(to);
  if (optOutStatus.optedOut) {
    const reason = optOutStatus.error ? 'opt_out_check_failed' : 'opted_out';
    logger.info({
      event: 'wa_marketing_opted_out_block',
      wa_id: to,
      templateName,
      reason
    });
    return { ok: false, skipped: true, reason };
  }

  const endpoint = `https://graph.facebook.com/v25.0/${phoneNumberId}/marketing_messages`;
  try {
    const result = await fetchMetaWithRetry(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode || 'ar' },
          components: components || []
        },
        ...(ttl_seconds ? { ttl: { seconds: ttl_seconds } } : {})
      })
    }, { event: 'wa_marketing_template_send', wa_id: to, templateName });

    const responseText = result.text || '';

    if (!result.ok) {
      logger.error({
        event: 'wa_marketing_api_error',
        status: result.status,
        wa_id: to,
        templateName,
        metaError: responseText.slice(0, 500)
      });
      return { ok: false, status: result.status, responseText: responseText.slice(0, 500), error: result.error };
    }

    let responseData = {};
    let messageId = null;
    try {
      responseData = JSON.parse(responseText);
      messageId = responseData?.messages?.[0]?.id;
    } catch (parseErr) {
      logger.error({ event: 'wa_marketing_parse_error', templateName, wa_id: to, error: parseErr.message });
    }

    // Persist outbound message to WhatsAppMessage for delivery tracking via webhook
    if (staffId || campaignId) {
      try {
        const WhatsAppMessage = require('../models/WhatsAppMessage');
        await WhatsAppMessage.create({
          message_id: messageId || `mktg_${campaignId || 'manual'}_${to}_${Date.now()}`,
          sender_wa_id: to,
          direction: 'outbound',
          message_type: 'text',
          text_body: templateName, // Store template name as body for reference
          platform: 'whatsapp',
          status: 'sent',
          is_template_message: true,
          sent_by_staff_id: staffId || null,
          campaign_id: campaignId || null,
          timestamp: new Date()
        });
      } catch (dbErr) {
        logger.error({ event: 'wa_marketing_persist_error', wa_id: to, templateName, error: dbErr.message });
      }
    }

    return { ok: true, messageId };
  } catch (error) {
    logger.error({ event: 'wa_marketing_send_error', error: error.message, wa_id: to, templateName, stack: error.stack });
    return { ok: false, error: error.message };
  }
};

module.exports = { postWhatsAppTemplate };

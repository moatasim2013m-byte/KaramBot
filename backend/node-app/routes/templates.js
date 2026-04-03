const express = require('express');
const TemplateDefinition = require('../models/TemplateDefinition');
const { authMiddleware, staffMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// ==================== TEMPLATE ROUTES ====================

/**
 * GET /api/templates
 * List approved WhatsApp templates
 */
router.get('/', authMiddleware, staffMiddleware, async (req, res) => {
  try {
    const { status, category, page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    
    const templates = await TemplateDefinition.find(query)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await TemplateDefinition.countDocuments(query);
    
    res.json({
      templates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

/**
 * POST /api/templates/sync
 * Sync templates from Meta Business Manager
 * 
 * NOTE: This is a placeholder. Real implementation would call Meta Graph API:
 * GET https://graph.facebook.com/v18.0/{WABA_ID}/message_templates
 * 
 * For now, we'll allow manual creation for testing
 */
router.post('/sync', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const wabaId = String(process.env.WHATSAPP_WABA_ID || '').trim();

    if (!accessToken || !wabaId) {
      return res.status(500).json({
        error: 'WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID must be set in environment variables'
      });
    }

    const endpoint = `https://graph.facebook.com/v23.0/${wabaId}/message_templates?fields=id,name,status,language,category,components,quality_score&limit=100&access_token=${accessToken}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let metaTemplates = [];
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      const responseText = await response.text();
      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(502).json({
          error: 'Meta API returned an error. Check WHATSAPP_ACCESS_TOKEN has whatsapp_business_management permission.',
          details: responseText.slice(0, 300)
        });
      }

      const data = JSON.parse(responseText);
      metaTemplates = Array.isArray(data.data) ? data.data : [];
    } catch (fetchErr) {
      clearTimeout(timeout);
      return res.status(502).json({ error: 'Failed to reach Meta API', details: fetchErr.message });
    }

    let synced = 0;
    let skipped = 0;
    const errors = [];

    for (const tpl of metaTemplates) {
      try {
        const bodyComponent = Array.isArray(tpl.components) ? tpl.components.find(c => c.type === 'BODY') : null;
        const headerComponent = Array.isArray(tpl.components) ? tpl.components.find(c => c.type === 'HEADER') : null;
        const footerComponent = Array.isArray(tpl.components) ? tpl.components.find(c => c.type === 'FOOTER') : null;
        const buttonsComponent = Array.isArray(tpl.components) ? tpl.components.find(c => c.type === 'BUTTONS') : null;

        const statusMap = { APPROVED: 'approved', PENDING: 'pending_review', PENDING_REVIEW: 'pending_review', REJECTED: 'rejected', DISABLED: 'disabled', PAUSED: 'paused' };
        const qualityMap = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

        await TemplateDefinition.findOneAndUpdate(
          { meta_template_id: String(tpl.id) },
          {
            $set: {
              meta_template_id: String(tpl.id),
              name: tpl.name,
              status: statusMap[tpl.status] || 'pending_review',
              language: tpl.language || 'ar',
              category: (tpl.category || 'marketing').toLowerCase(),
              body_text: bodyComponent?.text || '',
              header_type: headerComponent?.format?.toLowerCase() || null,
              header_text: headerComponent?.text || null,
              footer_text: footerComponent?.text || null,
              buttons: Array.isArray(buttonsComponent?.buttons)
                ? buttonsComponent.buttons.map(b => ({ type: (b.type || '').toLowerCase(), text: b.text || '', url: b.url, phone_number: b.phone_number }))
                : [],
              quality_score: qualityMap[tpl.quality_score?.score] || 'unknown',
              waba_id: wabaId,
              synced_from_meta_at: new Date(),
              last_sync_status: 'success'
            }
          },
          { upsert: true, new: true }
        );
        synced++;
      } catch (upsertErr) {
        errors.push({ id: tpl.id, name: tpl.name, error: upsertErr.message });
        skipped++;
      }
    }

    res.json({
      success: true,
      synced_count: synced,
      skipped_count: skipped,
      total_from_meta: metaTemplates.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Sync templates error:', error);
    res.status(500).json({ error: 'Failed to sync templates' });
  }
});

/**
 * POST /api/templates
 * Manually create template (for testing)
 */
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      meta_template_id,
      name,
      status,
      language,
      category,
      body_text,
      variables,
      header_type,
      footer_text,
      buttons
    } = req.body;
    
    if (!meta_template_id || !name || !category || !body_text) {
      return res.status(400).json({ error: 'Required fields: meta_template_id, name, category, body_text' });
    }
    
    // Check for duplicate
    const existing = await TemplateDefinition.findOne({ meta_template_id });
    if (existing) {
      return res.status(400).json({ error: `Template ${meta_template_id} already exists` });
    }
    
    const template = new TemplateDefinition({
      meta_template_id,
      name,
      status: status || 'approved',
      language: language || 'en_US',
      category,
      body_text,
      variables: variables || [],
      header_type,
      footer_text,
      buttons: buttons || [],
      synced_from_meta_at: new Date()
    });
    
    await template.save();
    
    res.status(201).json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * GET /api/templates/:id
 * Get single template
 */
router.get('/:id', authMiddleware, staffMiddleware, async (req, res) => {
  try {
    const template = await TemplateDefinition.findById(req.params.id);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ template });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

module.exports = router;
